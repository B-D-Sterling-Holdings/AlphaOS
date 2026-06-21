"""Main entry point for LLM Quant analysis."""

import argparse
import json
import os
import sys
from pathlib import Path
from datetime import datetime

from dotenv import load_dotenv

from .llm_engine import InferenceEngine
from .utils import setup_logging, load_yaml_config


def get_default_paths() -> tuple[Path, Path, Path]:
    """Get default paths relative to this file."""
    src_dir = Path(__file__).parent
    project_dir = src_dir.parent
    data_dir = project_dir / "data"
    config_dir = project_dir / "config"
    output_dir = project_dir / "outputs"
    return data_dir, config_dir, output_dir


def analyze_command(args):
    """Run analysis on one or more companies."""
    data_dir, config_dir, output_dir = get_default_paths()

    # Override with args if provided
    if args.data_dir:
        data_dir = Path(args.data_dir)
    if args.config_dir:
        config_dir = Path(args.config_dir)
    if args.output_dir:
        output_dir = Path(args.output_dir)

    # Set up logging
    log_level = "DEBUG" if args.verbose else "INFO"
    setup_logging(level=log_level, log_dir=output_dir / "logs")

    # Initialize engine
    engine = InferenceEngine(
        data_dir=data_dir,
        config_dir=config_dir,
        model=args.model,
    )

    # Test API connection
    if not engine.test_api():
        print("Failed to connect to Ollama. Is it running? Check OLLAMA_BASE_URL.")
        sys.exit(1)

    # Run analysis
    if args.all:
        print("Analyzing all companies...")
        results = engine.analyze_all(
            prompt_name=args.prompt,
            save_output=not args.no_save,
        )
        print(f"\nCompleted analysis of {len(results)} companies:")
        for ticker, result in results.items():
            print(f"  {ticker}: {result.recommendation.signal} ({result.recommendation.conviction})")
    else:
        ticker = args.ticker.upper()
        mode = getattr(args, 'mode', 'balanced')
        print(f"Analyzing {ticker} (mode: {mode})...")
        result = engine.analyze(
            ticker=ticker,
            prompt_name=args.prompt,
            sector=args.sector,
            mode=mode,
            save_output=not args.no_save,
            output_dir=output_dir / "recommendations",
        )

        # Print summary
        print(f"\n{'='*60}")
        print(f"Analysis Results for {ticker}")
        print(f"{'='*60}")
        print(f"Signal: {result.recommendation.signal}")
        print(f"Conviction: {result.recommendation.conviction}")
        print(f"Position Size: {result.recommendation.position_size_pct}%")

        if result.recommendation.price_target_12mo:
            print(f"Price Target (12mo): ${result.recommendation.price_target_12mo}")
        if result.recommendation.stop_loss_price:
            print(f"Stop Loss: ${result.recommendation.stop_loss_price}")

        if result.recommendation.key_catalysts:
            print(f"\nKey Catalysts:")
            for catalyst in result.recommendation.key_catalysts:
                print(f"  - {catalyst}")

        if result.recommendation.key_risks:
            print(f"\nKey Risks:")
            for risk in result.recommendation.key_risks:
                print(f"  - {risk}")

        if result.executive_summary:
            print(f"\nExecutive Summary:")
            print(f"  {result.executive_summary[:500]}...")

        print(f"{'='*60}")


def company_overview_command(args):
    """Generate an SEC-grounded business overview for one ticker.

    Fetches the latest 10-K (Item 1. Business as the primary source) and 10-Q
    (MD&A as a secondary source for recent updates), runs them through the
    company_overview prompt, and emits the result as JSON on stdout wrapped in
    sentinels so the calling API route can parse it cleanly past any log noise.
    """
    import logging as _logging

    from .data_ingestion import SECFilingsFetcher
    from .llm_engine import GeminiClient, PromptLoader

    # Keep stdout clean for the JSON payload: route all logging to stderr.
    _logging.basicConfig(level=_logging.INFO, stream=sys.stderr, force=True)

    _, config_dir, _ = get_default_paths()
    if args.config_dir:
        config_dir = Path(args.config_dir)

    ticker = args.ticker.upper()

    def emit(payload: dict):
        print("===PRISM_OVERVIEW_BEGIN===")
        print(json.dumps(payload))
        print("===PRISM_OVERVIEW_END===")

    try:
        user_agent = os.environ.get("SEC_USER_AGENT")
        fetcher = SECFilingsFetcher(user_agent=user_agent)
        filings = fetcher.fetch_company_filings(ticker)

        if not filings.tenk and not filings.tenq:
            emit({"error": f"No 10-K or 10-Q filings found on SEC EDGAR for {ticker}."})
            return

        context = fetcher.build_filing_context(filings)

        prompt_loader = PromptLoader(config_dir / "prompts")
        system_prompt = prompt_loader.load_prompt("company_overview")

        resolved_model = args.model or os.environ.get("GEMINI_MODEL") or "gemini-2.5-flash"
        llm = GeminiClient(model=resolved_model, temperature=0.2)

        full_prompt = (
            system_prompt
            + "\n\n---\n\n## Filing Excerpts\n\n"
            + context
            + "\n\n---\n\nReturn only the JSON object specified above."
        )
        raw = llm.generate(full_prompt, response_mime_type="application/json")

        try:
            overview = json.loads(raw)
        except json.JSONDecodeError:
            # Best-effort: strip code fences / surrounding text and retry.
            cleaned = raw.strip()
            cleaned = cleaned[cleaned.find("{"): cleaned.rfind("}") + 1]
            overview = json.loads(cleaned)

        # Attach authoritative source metadata so the UI can cite filings even if
        # the model's own sources_cited list is sparse.
        def filing_meta(f):
            if not f:
                return None
            return {
                "form": f.form,
                "accession": f.accession,
                "filing_date": f.filing_date,
                "report_date": f.report_date,
                "url": f.url,
                "sections_used": f.sections_used,
            }

        emit({
            "ticker": filings.ticker,
            "company_name": filings.company_name,
            "model": resolved_model,
            "overview": overview,
            "sources": {
                "tenk": filing_meta(filings.tenk),
                "tenq": filing_meta(filings.tenq),
            },
        })
    except Exception as e:
        emit({"error": str(e)})


def thesis_fundamentals_command(args):
    """Fill the four thesis fundamentals boxes from TTM data.

    Reads a JSON payload from stdin ({"ticker", "fundamentals": {...}}) — the
    TTM figures pre-computed from the equity research Fundamentals tab — runs
    them through the thesis_fundamentals prompt, and emits a JSON object with
    the four box strings, wrapped in sentinels for the calling API route.
    """
    import logging as _logging

    from .llm_engine import GeminiClient, PromptLoader

    _logging.basicConfig(level=_logging.INFO, stream=sys.stderr, force=True)

    _, config_dir, _ = get_default_paths()
    if args.config_dir:
        config_dir = Path(args.config_dir)

    def emit(payload: dict):
        print("===PRISM_THESIS_BEGIN===")
        print(json.dumps(payload))
        print("===PRISM_THESIS_END===")

    try:
        raw_in = sys.stdin.read()
        payload = json.loads(raw_in) if raw_in.strip() else {}
        ticker = (payload.get("ticker") or (args.ticker or "")).upper()
        fundamentals = payload.get("fundamentals") or {}

        if not fundamentals:
            emit({"error": "No fundamentals data provided. Generate data for this ticker first."})
            return

        prompt_loader = PromptLoader(config_dir / "prompts")
        system_prompt = prompt_loader.load_prompt("thesis_fundamentals")

        resolved_model = args.model or os.environ.get("GEMINI_MODEL") or "gemini-2.5-flash"
        llm = GeminiClient(model=resolved_model, temperature=0.2)

        context = (
            f"Ticker: {ticker}\n"
            f"As of (latest quarter): {fundamentals.get('asOf')}\n\n"
            "TTM fundamentals (pre-computed from the equity research Fundamentals tab):\n\n"
            + json.dumps(fundamentals, indent=2)
        )
        full_prompt = (
            system_prompt
            + "\n\n---\n\n## Fundamentals Data\n\n"
            + context
            + "\n\n---\n\nReturn only the JSON object with the four box keys."
        )
        raw = llm.generate(full_prompt, response_mime_type="application/json")

        try:
            boxes = json.loads(raw)
        except json.JSONDecodeError:
            cleaned = raw.strip()
            cleaned = cleaned[cleaned.find("{"): cleaned.rfind("}") + 1]
            boxes = json.loads(cleaned)

        # Only keep the recognized box keys; coerce everything to strings.
        keys = ["revenueGrowth", "profitability", "capitalReturn", "misc"]
        boxes = {k: str(boxes.get(k, "") or "") for k in keys}

        emit({"ticker": ticker, "model": resolved_model, "boxes": boxes})
    except Exception as e:
        emit({"error": str(e)})


def watchlist_perspective_command(args):
    """Fast DHQ triage on a freshly-added watchlist name.

    Reads a JSON payload from stdin ({"ticker", "quote", "fundamentals",
    "priceChanges", "note"}) assembled by the /api/watchlist/ai-perspective
    route, runs it through the investment philosophy + watchlist_perspective
    triage prompt, and emits a compact two-gate verdict (quality + dislocation)
    plus an overall DHQ-fit, wrapped in sentinels for the calling route.
    """
    import logging as _logging

    from .llm_engine import GeminiClient, PromptLoader

    _logging.basicConfig(level=_logging.INFO, stream=sys.stderr, force=True)

    _, config_dir, _ = get_default_paths()
    if args.config_dir:
        config_dir = Path(args.config_dir)

    def emit(payload: dict):
        print("===PRISM_PERSPECTIVE_BEGIN===")
        print(json.dumps(payload))
        print("===PRISM_PERSPECTIVE_END===")

    try:
        raw_in = sys.stdin.read()
        payload = json.loads(raw_in) if raw_in.strip() else {}
        ticker = (payload.get("ticker") or (args.ticker or "")).upper()
        if not ticker:
            emit({"error": "No ticker provided."})
            return

        prompt_loader = PromptLoader(config_dir / "prompts")
        philosophy = prompt_loader.load_prompt("investment_philosophy")
        triage = prompt_loader.load_prompt("watchlist_perspective")

        resolved_model = args.model or os.environ.get("GEMINI_MODEL") or "gemini-2.5-flash"
        llm = GeminiClient(model=resolved_model, temperature=0.2)

        context = {
            "ticker": ticker,
            "quote": payload.get("quote") or {},
            "valuation": payload.get("fundamentals") or {},
            "priceChanges": payload.get("priceChanges") or {},
            "analystNote": payload.get("note") or "",
            "analystResearch": payload.get("analystResearch") or {},
        }
        full_prompt = (
            philosophy
            + "\n\n---\n\n"
            + triage
            + "\n\n---\n\n## Triage Payload\n\n"
            + json.dumps(context, indent=2)
            + "\n\n---\n\nReturn only the JSON object defined in Watchlist Triage Mode."
        )
        raw = llm.generate(full_prompt, response_mime_type="application/json")

        try:
            result = json.loads(raw)
        except json.JSONDecodeError:
            cleaned = raw.strip()
            cleaned = cleaned[cleaned.find("{"): cleaned.rfind("}") + 1]
            result = json.loads(cleaned)

        emit({"ticker": ticker, "model": resolved_model, "perspective": result})
    except Exception as e:
        emit({"error": str(e)})


def batch_command(args):
    """Generate batch report for multiple tickers."""
    data_dir, config_dir, output_dir = get_default_paths()

    setup_logging(level="INFO", log_dir=output_dir / "logs")

    engine = InferenceEngine(
        data_dir=data_dir,
        config_dir=config_dir,
        model=args.model,
    )

    # Parse tickers
    tickers = [t.strip().upper() for t in args.tickers.split(",")]
    print(f"Running batch analysis for {len(tickers)} tickers...")

    results = engine.analyze_batch(tickers)

    # Create batch report
    report = {
        "generated_at": datetime.now().isoformat(),
        "model": args.model,
        "ticker_count": len(tickers),
        "results": {},
    }

    for ticker, result in results.items():
        report["results"][ticker] = {
            "signal": result.recommendation.signal,
            "conviction": result.recommendation.conviction,
            "position_size_pct": result.recommendation.position_size_pct,
            "key_catalysts": result.recommendation.key_catalysts,
            "key_risks": result.recommendation.key_risks,
        }

    # Save report
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"Batch report saved to: {output_path}")

    # Print summary
    print(f"\nBatch Summary:")
    for ticker, result in results.items():
        print(f"  {ticker}: {result.recommendation.signal}")


def list_command(args):
    """List available tickers."""
    data_dir, _, _ = get_default_paths()
    if args.data_dir:
        data_dir = Path(args.data_dir)

    from .data_ingestion import CSVParser

    parser = CSVParser(data_dir)
    tickers = parser.get_available_tickers()

    if not tickers:
        print(f"No data found in {data_dir}")
        return

    print(f"Available tickers ({len(tickers)}):")
    for ticker in tickers:
        summary = parser.get_data_summary(ticker)
        file_count = len(summary.get("files", {}))
        print(f"  {ticker}: {file_count} data files")


def info_command(args):
    """Show information about a ticker's data."""
    data_dir, _, _ = get_default_paths()
    if args.data_dir:
        data_dir = Path(args.data_dir)

    from .data_ingestion import CSVParser

    parser = CSVParser(data_dir)
    ticker = args.ticker.upper()
    summary = parser.get_data_summary(ticker)

    if "error" in summary:
        print(summary["error"])
        return

    print(f"\nData Summary for {ticker}")
    print("=" * 50)

    print("\nFiles:")
    for key, info in summary.get("files", {}).items():
        date_info = summary.get("date_ranges", {}).get(key, {})
        date_range = ""
        if date_info.get("min") and date_info.get("max"):
            date_range = f" [{date_info['min']} to {date_info['max']}]"
        print(f"  {key}: {info['rows']} rows{date_range}")


def main():
    """Main entry point."""
    # Load environment variables
    load_dotenv()

    parser = argparse.ArgumentParser(
        description="LLM Quant: AI-Powered Fundamental Analysis",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # Analyze command
    analyze_parser = subparsers.add_parser("analyze", help="Analyze a company")
    analyze_parser.add_argument("--ticker", "-t", help="Ticker symbol to analyze")
    analyze_parser.add_argument("--all", "-a", action="store_true", help="Analyze all tickers")
    analyze_parser.add_argument("--sector", "-s", help="Sector for sector-specific analysis")
    analyze_parser.add_argument("--prompt", "-p", help="Custom prompt file path")
    analyze_parser.add_argument("--mode", choices=["balanced", "critique"],
                               default="balanced",
                               help="Analysis mode: 'balanced' (standard DHQ analysis) or "
                                    "'critique' (red-team the analyst's saved thesis)")
    analyze_parser.add_argument("--model", "-m",
                               default=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
                               help="Gemini model to use (or set GEMINI_MODEL)")
    analyze_parser.add_argument("--data-dir", help="Data directory path")
    analyze_parser.add_argument("--config-dir", help="Config directory path")
    analyze_parser.add_argument("--output-dir", help="Output directory path")
    analyze_parser.add_argument("--no-save", action="store_true", help="Don't save output files")
    analyze_parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    analyze_parser.set_defaults(func=analyze_command)

    # Company overview command (SEC-grounded business overview)
    overview_parser = subparsers.add_parser(
        "company-overview",
        help="Generate an SEC-grounded business overview (10-K Item 1 + 10-Q)",
    )
    overview_parser.add_argument("--ticker", "-t", required=True, help="Ticker symbol")
    overview_parser.add_argument("--model", "-m",
                                 default=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
                                 help="Gemini model to use (or set GEMINI_MODEL)")
    overview_parser.add_argument("--config-dir", help="Config directory path")
    overview_parser.set_defaults(func=company_overview_command)

    # Thesis fundamentals command (fills the 4 thesis boxes from TTM data)
    thesis_parser = subparsers.add_parser(
        "thesis-fundamentals",
        help="Fill the four thesis fundamentals boxes from TTM data (reads JSON on stdin)",
    )
    thesis_parser.add_argument("--ticker", "-t",
                               help="Ticker symbol (optional; the stdin payload takes precedence)")
    thesis_parser.add_argument("--model", "-m",
                               default=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
                               help="Gemini model to use (or set GEMINI_MODEL)")
    thesis_parser.add_argument("--config-dir", help="Config directory path")
    thesis_parser.set_defaults(func=thesis_fundamentals_command)

    # Watchlist perspective command (fast DHQ triage; reads JSON on stdin)
    perspective_parser = subparsers.add_parser(
        "watchlist-perspective",
        help="Fast DHQ triage on a watchlist name (reads JSON on stdin)",
    )
    perspective_parser.add_argument("--ticker", "-t",
                                    help="Ticker symbol (optional; the stdin payload takes precedence)")
    perspective_parser.add_argument("--model", "-m",
                                    default=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
                                    help="Gemini model to use (or set GEMINI_MODEL)")
    perspective_parser.add_argument("--config-dir", help="Config directory path")
    perspective_parser.set_defaults(func=watchlist_perspective_command)

    # Batch command
    batch_parser = subparsers.add_parser("batch-report", help="Generate batch report")
    batch_parser.add_argument("--tickers", required=True, help="Comma-separated list of tickers")
    batch_parser.add_argument("--output", "-o", required=True, help="Output file path")
    batch_parser.add_argument("--model", "-m",
                             default=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"))
    batch_parser.set_defaults(func=batch_command)

    # List command
    list_parser = subparsers.add_parser("list", help="List available tickers")
    list_parser.add_argument("--data-dir", help="Data directory path")
    list_parser.set_defaults(func=list_command)

    # Info command
    info_parser = subparsers.add_parser("info", help="Show ticker data info")
    info_parser.add_argument("ticker", help="Ticker symbol")
    info_parser.add_argument("--data-dir", help="Data directory path")
    info_parser.set_defaults(func=info_command)

    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        sys.exit(1)

    # Validate analyze command
    if args.command == "analyze" and not args.all and not args.ticker:
        print("Error: Either --ticker or --all is required")
        sys.exit(1)

    # Run the command
    args.func(args)


if __name__ == "__main__":
    main()
