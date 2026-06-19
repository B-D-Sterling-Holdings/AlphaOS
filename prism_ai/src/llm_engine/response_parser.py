"""Parse LLM responses into structured output."""

import json
import re
from typing import Optional, Any
from dataclasses import dataclass, field
import logging

logger = logging.getLogger(__name__)


@dataclass
class AnalysisRecommendation:
    """Structured recommendation from analysis."""

    signal: str  # BUY, HOLD, SELL, AVOID
    conviction: str  # VERY_HIGH, HIGH, MODERATE, LOW
    position_size_pct: float
    expected_return_pct: Optional[float] = None
    price_dislocation: Optional[str] = None  # YES_DOWN_FROM_HIGH, YES_TRADING_FLAT, NO
    price_dislocation_detail: Optional[str] = None
    price_target_12mo: Optional[float] = None
    stop_loss_price: Optional[float] = None
    key_catalysts: list[str] = field(default_factory=list)
    key_risks: list[str] = field(default_factory=list)
    review_trigger: Optional[str] = None
    reasoning: Optional[str] = None
    raw_json: Optional[dict] = None


@dataclass
class AnalysisResult:
    """Full analysis result including reasoning."""

    ticker: str
    recommendation: AnalysisRecommendation
    full_response: str
    executive_summary: Optional[str] = None
    fundamental_analysis: Optional[str] = None
    qualitative_factors: Optional[str] = None
    risk_factors: Optional[str] = None
    parse_errors: list[str] = field(default_factory=list)


class ResponseParser:
    """Parse LLM responses into structured analysis results."""

    # Regex patterns for extracting JSON
    JSON_PATTERNS = [
        r"```json\s*(.*?)\s*```",  # JSON in code blocks
        r"```\s*(.*?)\s*```",  # Generic code blocks
    ]

    # Section headers to extract
    SECTION_HEADERS = [
        ("executive_summary", r"(?:##?\s*)?(?:1\.\s*)?Executive Summary"),
        ("fundamental_analysis", r"(?:##?\s*)?(?:2\.\s*)?Fundamental Analysis"),
        ("qualitative_factors", r"(?:##?\s*)?(?:3\.\s*)?Qualitative Factors"),
        ("risk_factors", r"(?:##?\s*)?(?:4\.\s*)?Risk Factors"),
        ("recommendation", r"(?:##?\s*)?(?:5\.\s*)?Recommendation"),
    ]

    def parse_response(self, response: str, ticker: str) -> AnalysisResult:
        """
        Parse full LLM response into structured result.

        Args:
            response: Raw LLM response text
            ticker: Company ticker symbol

        Returns:
            AnalysisResult with structured data
        """
        errors = []

        # Prefer full JSON response when available
        json_data = self._try_parse_json(response)
        if json_data is not None:
            recommendation = self._recommendation_from_json(json_data)
            sections = self._sections_from_json(json_data) or {}
        else:
            recommendation = self._extract_recommendation(response)
            sections = self._extract_sections(response)

        if recommendation is None:
            errors.append("Could not extract JSON recommendation from response")
            recommendation = AnalysisRecommendation(
                signal="UNKNOWN",
                conviction="UNKNOWN",
                position_size_pct=0.0,
            )

        return AnalysisResult(
            ticker=ticker,
            recommendation=recommendation,
            full_response=response,
            executive_summary=sections.get("executive_summary"),
            fundamental_analysis=sections.get("fundamental_analysis"),
            qualitative_factors=sections.get("qualitative_factors"),
            risk_factors=sections.get("risk_factors"),
            parse_errors=errors,
        )

    def _try_parse_json(self, response: str) -> Optional[dict]:
        """Attempt to parse the full response as JSON."""
        text = response.strip()
        if not text:
            return None

        # Strip markdown code blocks if present
        if text.startswith("```"):
            # Remove opening ```json or ```
            lines = text.split("\n", 1)
            if len(lines) > 1:
                text = lines[1]
            # Remove closing ```
            if text.rstrip().endswith("```"):
                text = text.rstrip()[:-3].rstrip()

        # Try to find JSON object in the text
        start_idx = text.find("{")
        end_idx = text.rfind("}")

        if start_idx == -1 or end_idx == -1 or end_idx <= start_idx:
            return None

        json_str = text[start_idx:end_idx + 1]

        try:
            data = json.loads(json_str)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            return None
        return None

    def _recommendation_from_json(self, data: dict) -> Optional[AnalysisRecommendation]:
        """Extract recommendation from a JSON response."""
        if "recommendation" in data and isinstance(data["recommendation"], dict):
            return self._json_to_recommendation(data["recommendation"])
        if "signal" in data:
            return self._json_to_recommendation(data)
        return None

    def _sections_from_json(self, data: dict) -> Optional[dict[str, str]]:
        """Extract sections from a JSON response."""
        sections = data.get("sections")
        if isinstance(sections, dict):
            return sections
        return None

    def _extract_recommendation(self, response: str) -> Optional[AnalysisRecommendation]:
        """
        Extract JSON recommendation from response.

        Args:
            response: Raw response text

        Returns:
            AnalysisRecommendation or None if parsing fails
        """
        # Try each pattern for code blocks
        for pattern in self.JSON_PATTERNS:
            matches = re.findall(pattern, response, re.DOTALL | re.IGNORECASE)
            for match in matches:
                try:
                    json_str = match.strip()
                    if not json_str.startswith("{"):
                        start = json_str.find("{")
                        if start != -1:
                            json_str = json_str[start:]

                    data = json.loads(json_str)

                    if "recommendation" in data and isinstance(data["recommendation"], dict):
                        return self._json_to_recommendation(data["recommendation"])
                    if "signal" in data:
                        return self._json_to_recommendation(data)
                except json.JSONDecodeError:
                    continue

        # Try to extract JSON object with balanced braces
        json_data = self._extract_balanced_json(response)
        if json_data is not None:
            if "recommendation" in json_data and isinstance(json_data["recommendation"], dict):
                return self._json_to_recommendation(json_data["recommendation"])
            if "signal" in json_data:
                return self._json_to_recommendation(json_data)

        # Fallback: try to find signal in text
        logger.warning("Could not parse JSON, attempting text extraction")
        return self._extract_recommendation_from_text(response)

    def _extract_balanced_json(self, text: str) -> Optional[dict]:
        """
        Extract a JSON object from text by finding balanced braces.

        Args:
            text: Text potentially containing JSON

        Returns:
            Parsed JSON dict or None
        """
        start_idx = text.find("{")
        if start_idx == -1:
            return None

        # Find matching closing brace by counting
        depth = 0
        in_string = False
        escape_next = False

        for i, char in enumerate(text[start_idx:], start=start_idx):
            if escape_next:
                escape_next = False
                continue

            if char == "\\":
                escape_next = True
                continue

            if char == '"' and not escape_next:
                in_string = not in_string
                continue

            if in_string:
                continue

            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    json_str = text[start_idx:i + 1]
                    try:
                        data = json.loads(json_str)
                        if isinstance(data, dict):
                            return data
                    except json.JSONDecodeError:
                        return None
                    return None

        return None

    def _json_to_recommendation(self, data: dict) -> AnalysisRecommendation:
        """
        Convert JSON dict to AnalysisRecommendation.

        Args:
            data: Parsed JSON dictionary

        Returns:
            AnalysisRecommendation object
        """
        return AnalysisRecommendation(
            signal=data.get("signal", "UNKNOWN").upper(),
            conviction=data.get("conviction", "UNKNOWN").upper(),
            position_size_pct=float(data.get("position_size_pct", 0)),
            expected_return_pct=self._safe_float(data.get("expected_return_pct")),
            price_dislocation=data.get("price_dislocation"),
            price_dislocation_detail=data.get("price_dislocation_detail"),
            price_target_12mo=self._safe_float(data.get("price_target_12mo")),
            stop_loss_price=self._safe_float(data.get("stop_loss_price")),
            key_catalysts=data.get("key_catalysts", []),
            key_risks=data.get("key_risks", []),
            review_trigger=data.get("review_trigger"),
            reasoning=data.get("reasoning"),
            raw_json=data,
        )

    def _safe_float(self, value: Any) -> Optional[float]:
        """Safely convert value to float."""
        if value is None:
            return None
        try:
            return float(value)
        except (ValueError, TypeError):
            return None

    def _extract_recommendation_from_text(
        self, response: str
    ) -> Optional[AnalysisRecommendation]:
        """
        Extract recommendation from plain text when JSON parsing fails.

        Args:
            response: Raw response text

        Returns:
            AnalysisRecommendation or None
        """
        # Use recommendation section if present to avoid false positives
        sections = self._extract_sections(response)
        source_text = sections.get("recommendation", response)

        # Look for signal keywords (prioritize explicit "signal" field)
        signal = "UNKNOWN"
        signal_match = re.search(
            r"\bsignal[:\s]*\b(BUY|HOLD|SELL|AVOID)\b", source_text, re.IGNORECASE
        )
        if signal_match:
            signal = signal_match.group(1).upper()
        else:
            signal_patterns = [
                (r"\b(BUY)\b", "BUY"),
                (r"\b(SELL)\b", "SELL"),
                (r"\b(HOLD)\b", "HOLD"),
                (r"\b(AVOID)\b", "AVOID"),
            ]
            for pattern, sig in signal_patterns:
                if re.search(pattern, source_text, re.IGNORECASE):
                    signal = sig
                    break

        # Look for conviction
        conviction = "UNKNOWN"
        conviction_patterns = [
            (r"\bconviction[:\s]*very\s*high\b", "VERY_HIGH"),
            (r"\bconviction[:\s]*high\b", "HIGH"),
            (r"\bconviction[:\s]*moderate\b", "MODERATE"),
            (r"\bconviction[:\s]*low\b", "LOW"),
            (r"\bvery\s*high\s*conviction\b", "VERY_HIGH"),
            (r"\bhigh\s*conviction\b", "HIGH"),
            (r"\bmoderate\s*conviction\b", "MODERATE"),
            (r"\blow\s*conviction\b", "LOW"),
            (r"\bconfidence[:\s]*very\s*high\b", "VERY_HIGH"),
            (r"\bconfidence[:\s]*high\b", "HIGH"),
            (r"\bconfidence[:\s]*moderate\b", "MODERATE"),
            (r"\bconfidence[:\s]*low\b", "LOW"),
        ]
        for pattern, conv in conviction_patterns:
            if re.search(pattern, source_text, re.IGNORECASE):
                conviction = conv
                break

        # Look for position size
        position_size = 0.0
        range_match = re.search(
            r"(?:position|allocation)[_\s]*size[:\s]*"
            r"(\d+\.?\d*)\s*(?:-|–|to)\s*(\d+\.?\d*)%?",
            source_text,
            re.IGNORECASE,
        )
        if range_match:
            try:
                low = float(range_match.group(1))
                high = float(range_match.group(2))
                position_size = (low + high) / 2.0
            except ValueError:
                pass
        else:
            size_match = re.search(
                r"(?:position|allocation)[_\s]*size[:\s]*(\d+\.?\d*)%?",
                source_text,
                re.IGNORECASE,
            )
            if size_match:
                try:
                    position_size = float(size_match.group(1))
                except ValueError:
                    pass

        if signal == "UNKNOWN":
            return None

        return AnalysisRecommendation(
            signal=signal,
            conviction=conviction,
            position_size_pct=position_size,
        )

    def _extract_sections(self, response: str) -> dict[str, str]:
        """
        Extract named sections from response.

        Args:
            response: Raw response text

        Returns:
            Dictionary of section name to content
        """
        sections = {}
        lines = response.split("\n")

        current_section = None
        current_content = []

        for line in lines:
            # Check if this line is a section header
            matched_section = None
            for section_name, pattern in self.SECTION_HEADERS:
                if re.match(pattern, line.strip(), re.IGNORECASE):
                    matched_section = section_name
                    break

            if matched_section:
                # Save previous section if exists
                if current_section and current_content:
                    sections[current_section] = "\n".join(current_content).strip()

                current_section = matched_section
                current_content = []
            elif current_section:
                current_content.append(line)

        # Save last section
        if current_section and current_content:
            sections[current_section] = "\n".join(current_content).strip()

        return sections

    def to_json(self, result: AnalysisResult) -> dict:
        """
        Convert AnalysisResult to JSON-serializable dictionary.

        Args:
            result: AnalysisResult object

        Returns:
            Dictionary suitable for JSON serialization
        """
        return {
            "ticker": result.ticker,
            "recommendation": {
                "signal": result.recommendation.signal,
                "conviction": result.recommendation.conviction,
                "position_size_pct": result.recommendation.position_size_pct,
                "expected_return_pct": result.recommendation.expected_return_pct,
                "price_dislocation": result.recommendation.price_dislocation,
                "price_dislocation_detail": result.recommendation.price_dislocation_detail,
                "key_catalysts": result.recommendation.key_catalysts,
                "key_risks": result.recommendation.key_risks,
                "review_trigger": result.recommendation.review_trigger,
                "reasoning": result.recommendation.reasoning,
            },
            "sections": {
                "executive_summary": result.executive_summary,
                "fundamental_analysis": result.fundamental_analysis,
                "qualitative_factors": result.qualitative_factors,
                "risk_factors": result.risk_factors,
            },
            "parse_errors": result.parse_errors,
        }

    def validate_recommendation(self, rec: AnalysisRecommendation) -> list[str]:
        """
        Validate a recommendation for completeness and consistency.

        Args:
            rec: Recommendation to validate

        Returns:
            List of validation warnings
        """
        warnings = []

        valid_signals = {"BUY", "HOLD", "SELL", "AVOID", "UNKNOWN"}
        if rec.signal not in valid_signals:
            warnings.append(f"Invalid signal: {rec.signal}")

        valid_convictions = {"VERY_HIGH", "HIGH", "MODERATE", "LOW", "UNKNOWN"}
        if rec.conviction not in valid_convictions:
            warnings.append(f"Invalid conviction: {rec.conviction}")

        if rec.position_size_pct < 0 or rec.position_size_pct > 10:
            warnings.append(f"Position size out of range: {rec.position_size_pct}%")

        if rec.signal == "BUY" and rec.position_size_pct == 0:
            warnings.append("BUY signal with 0% position size")

        if rec.signal in {"SELL", "AVOID"} and rec.position_size_pct > 0:
            warnings.append(f"{rec.signal} signal should have 0% position size")

        return warnings
