"""Main inference engine for running analysis."""

from pathlib import Path
from typing import Optional
from datetime import datetime
import json
import logging
import os
import time

from .gemini_client import GeminiClient
from .prompt_loader import PromptLoader
from .response_parser import ResponseParser, AnalysisResult
from ..context_builder import ContextAssembler
from ..data_ingestion import CSVParser, PDFExtractor
from ..utils.supabase_store import SupabaseStore

logger = logging.getLogger(__name__)


class InferenceEngine:
    """Main engine for running investment analysis."""

    def __init__(
        self,
        data_dir: Path | str,
        config_dir: Optional[Path | str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        max_output_tokens: int = 65536,
        enable_context_cache: bool = False,
        cache_ttl_seconds: Optional[int] = None,  # kept for interface parity
    ):
        """
        Initialize the inference engine.

        Args:
            data_dir: Directory containing company data
            config_dir: Directory containing configuration files
            api_key: Gemini API key (or set GEMINI_API_KEY env var)
            model: Gemini model to use (or set GEMINI_MODEL env var)
            max_output_tokens: Maximum tokens to generate (default 65536)
            enable_context_cache: Unused here; kept for interface parity
            cache_ttl_seconds: Unused here; kept for interface parity
        """
        self.data_dir = Path(data_dir)

        if config_dir is None:
            config_dir = Path(__file__).parent.parent.parent / "config"
        self.config_dir = Path(config_dir)

        # Initialize components
        resolved_model = model or os.environ.get("GEMINI_MODEL") or "gemini-2.5-flash"
        self.llm = GeminiClient(api_key=api_key, model=resolved_model, max_output_tokens=max_output_tokens)
        self.prompt_loader = PromptLoader(self.config_dir / "prompts")
        self.csv_parser = CSVParser(self.data_dir)
        self.pdf_extractor = PDFExtractor()
        self.context_assembler = ContextAssembler()
        self.response_parser = ResponseParser()
        self.store = SupabaseStore()

        # Ollama keeps the model warm via keep_alive; there is no server-side
        # context cache, so caching stays disabled regardless of this flag.
        self.enable_context_cache = False
        self.cache_ttl_seconds = cache_ttl_seconds

        logger.info(f"Initialized InferenceEngine with data_dir: {self.data_dir}")

    def analyze(
        self,
        ticker: str,
        prompt_name: Optional[str] = None,
        sector: Optional[str] = None,
        mode: str = "balanced",
        save_output: bool = True,
        output_dir: Optional[Path | str] = None,
        use_context_cache: Optional[bool] = None,  # None means use instance default
    ) -> AnalysisResult:
        """
        Run analysis on a company.

        Args:
            ticker: Company ticker symbol
            prompt_name: Custom prompt file to use (default: investment_philosophy)
            sector: Sector for sector-specific analysis
            save_output: Whether to save output to file
            output_dir: Directory for output files
            use_context_cache: Override instance context cache setting for this call

        Returns:
            AnalysisResult with recommendation and reasoning
        """
        logger.info(f"Starting analysis for {ticker}")
        start_time = time.time()

        # Load data
        csv_data = self.csv_parser.load_company_data(ticker)
        pdf_text = self.pdf_extractor.extract_from_company(self.data_dir, ticker)

        # Assemble context
        context = self.context_assembler.assemble_context(
            ticker=ticker,
            csv_data=csv_data,
            pdf_text=pdf_text,
        )

        # Load prompt
        if prompt_name:
            system_prompt = self.prompt_loader.load_custom_prompt(prompt_name)
        else:
            system_prompt = self.prompt_loader.load_combined_prompt(
                include_sizing=True,
                sector=sector,
                mode=mode,
            )

        # Run inference against the local Ollama model
        logger.info(f"Sending request to Gemini ({self.llm.model_name}) for {ticker}")
        api_start = time.time()
        response = self.llm.generate_with_context(
            system_prompt=system_prompt,
            context=context,
        )
        api_elapsed = time.time() - api_start
        logger.info(f"[API CALL] Gemini responded in {api_elapsed:.2f}s")

        # Parse response
        result = self.response_parser.parse_response(response, ticker)

        # Set expected return from valuation data if available
        valuation_df = csv_data.get("valuation/valuation")
        if (
            valuation_df is None
            or "expected_return" not in valuation_df.columns
            or valuation_df["expected_return"].dropna().empty
        ):
            result.recommendation.expected_return_pct = None
        else:
            # Extract the expected return value from the CSV
            expected_return = valuation_df["expected_return"].dropna().iloc[0]
            result.recommendation.expected_return_pct = float(expected_return)

        # Validate
        warnings = self.response_parser.validate_recommendation(result.recommendation)
        if warnings:
            logger.warning(f"Recommendation warnings for {ticker}: {warnings}")
            result.parse_errors.extend(warnings)

        # Save output
        if save_output:
            self._save_result(result, output_dir, mode=mode)

        logger.info(
            f"Analysis complete for {ticker}: {result.recommendation.signal} "
            f"({result.recommendation.conviction})"
        )

        return result

    def analyze_batch(
        self,
        tickers: list[str],
        prompt_name: Optional[str] = None,
        sector_map: Optional[dict[str, str]] = None,
        save_output: bool = True,
    ) -> dict[str, AnalysisResult]:
        """
        Run analysis on multiple companies.

        Args:
            tickers: List of ticker symbols
            prompt_name: Custom prompt to use
            sector_map: Dictionary mapping ticker to sector
            save_output: Whether to save output files

        Returns:
            Dictionary mapping ticker to AnalysisResult
        """
        results = {}
        sector_map = sector_map or {}

        for ticker in tickers:
            try:
                sector = sector_map.get(ticker)
                result = self.analyze(
                    ticker=ticker,
                    prompt_name=prompt_name,
                    sector=sector,
                    save_output=save_output,
                )
                results[ticker] = result
            except Exception as e:
                logger.error(f"Error analyzing {ticker}: {e}")
                # Create error result
                results[ticker] = AnalysisResult(
                    ticker=ticker,
                    recommendation=self.response_parser._json_to_recommendation({
                        "signal": "ERROR",
                        "conviction": "N/A",
                        "position_size_pct": 0,
                    }),
                    full_response="",
                    parse_errors=[str(e)],
                )

        return results

    def analyze_all(
        self,
        prompt_name: Optional[str] = None,
        save_output: bool = True,
    ) -> dict[str, AnalysisResult]:
        """
        Analyze all companies in the data directory.

        Args:
            prompt_name: Custom prompt to use
            save_output: Whether to save output files

        Returns:
            Dictionary mapping ticker to AnalysisResult
        """
        tickers = self.csv_parser.get_available_tickers()
        logger.info(f"Found {len(tickers)} companies to analyze")
        return self.analyze_batch(tickers, prompt_name, save_output=save_output)

    def _save_result(
        self,
        result: AnalysisResult,
        output_dir: Optional[Path | str] = None,
        mode: str = "balanced",
    ):
        """Persist an analysis result.

        Primary sink is Supabase (``prism_recommendations``), so no local output
        files are produced when Supabase is configured. Falls back to writing
        JSON + Markdown to disk for standalone/dev use without Supabase.
        """
        now = datetime.now()
        date_str = now.strftime("%Y%m%d_%H%M%S")
        source_file = f"{date_str}_{result.ticker}_analysis.json"

        data = self.response_parser.to_json(result)
        data["analysis_date"] = now.isoformat()
        data["model"] = self.llm.model_name
        data["analysis_mode"] = mode

        # Primary: store directly in Supabase (no local files). On any failure
        # (e.g. table missing, transient error) fall through to a disk write so a
        # completed analysis is never lost.
        if self.store.is_configured():
            try:
                rec = data.get("recommendation", {}) or {}
                signal = (rec.get("signal") or "").upper()
                if signal == "SELL":
                    signal = "AVOID"
                self.store.upsert_recommendation({
                    "ticker": result.ticker.upper(),
                    "analysis_date": data["analysis_date"],
                    "signal": signal or None,
                    "conviction": rec.get("conviction") or None,
                    "position_size_pct": rec.get("position_size_pct"),
                    "price_target": rec.get("price_target_12mo"),
                    "expected_return_pct": rec.get("expected_return_pct"),
                    "model": data["model"],
                    "analysis_mode": mode,
                    "recommendation": rec,
                    "sections": data.get("sections", {}),
                    "full_response": result.full_response,
                    "source_file": source_file,
                })
                logger.info(f"Saved analysis for {result.ticker} to Supabase")
                return
            except Exception as e:
                logger.warning(f"Supabase save failed ({e}); writing to local files instead")

        # Fallback: write to disk (standalone use, or Supabase unavailable).
        if output_dir is None:
            output_dir = self.data_dir.parent / "outputs" / "recommendations"
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        with open(output_dir / source_file, "w") as f:
            json.dump(data, f, indent=2)
        logger.info(f"Saved analysis to {output_dir / source_file}")

        md_filepath = output_dir / f"{date_str}_{result.ticker}_analysis.md"
        with open(md_filepath, "w") as f:
            f.write(f"# {result.ticker} Analysis\n\n")
            f.write(f"*Generated: {now.strftime('%Y-%m-%d %H:%M')}*\n\n")
            f.write(result.full_response)
        logger.debug(f"Saved full response to {md_filepath}")

    def get_data_summary(self, ticker: str) -> dict:
        """Get summary of available data for a ticker."""
        return self.csv_parser.get_data_summary(ticker)

    def list_available_tickers(self) -> list[str]:
        """List all tickers with data available."""
        return self.csv_parser.get_available_tickers()

    def test_api(self) -> bool:
        """Test the Ollama connection."""
        return self.llm.test_connection()

    # ============ Context Cache Methods ============

    def get_context_cache_savings(self) -> dict:
        """Get cumulative context cache savings statistics."""
        return self.llm.get_cache_savings_report()
