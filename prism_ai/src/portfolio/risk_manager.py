"""Risk assessment and management for portfolio positions."""

from dataclasses import dataclass, field
from typing import Optional
import pandas as pd
import logging

logger = logging.getLogger(__name__)


@dataclass
class RiskScore:
    """Detailed risk score breakdown."""

    total_score: int
    risk_level: str  # LOW, MODERATE, HIGH, VERY_HIGH
    components: dict[str, int]
    disqualifiers: list[str]
    notes: list[str] = field(default_factory=list)


@dataclass
class RiskMetrics:
    """Key risk metrics for a company."""

    debt_to_equity: Optional[float] = None
    interest_coverage: Optional[float] = None
    current_ratio: Optional[float] = None
    debt_to_ebitda: Optional[float] = None
    fcf_negative_years: int = 0
    revenue_decline_years: int = 0
    operating_cash_flow_positive_years: int = 0


class RiskManager:
    """Assess and manage investment risk."""

    # Risk score thresholds
    RISK_LEVELS = {
        (0, 4): "LOW",
        (5, 8): "MODERATE",
        (9, 12): "HIGH",
        (13, float("inf")): "VERY_HIGH",
    }

    # Risk point assignments
    RISK_POINTS = {
        "high_customer_concentration": 2,
        "declining_industry": 2,
        "currency_exposure": 1,
        "guidance_cut": 1,
        "insider_selling": 1,
        "high_debt_to_equity": 2,
        "low_interest_coverage": 2,
        "low_current_ratio": 1,
        "margin_compression": 1,
        "revenue_deceleration": 1,
    }

    def __init__(self):
        """Initialize the risk manager."""
        pass

    def calculate_risk_score(
        self,
        metrics: RiskMetrics,
        qualitative_factors: Optional[dict] = None,
    ) -> RiskScore:
        """
        Calculate comprehensive risk score.

        Args:
            metrics: Financial risk metrics
            qualitative_factors: Optional qualitative risk factors

        Returns:
            RiskScore with detailed breakdown
        """
        components = {}
        disqualifiers = []
        notes = []

        # Check automatic disqualifiers
        disqualifiers.extend(self._check_disqualifiers(metrics))

        # Calculate component scores
        # Debt risk
        if metrics.debt_to_equity is not None:
            if metrics.debt_to_equity > 1.5:
                components["high_debt_to_equity"] = 2
                notes.append(f"High debt/equity: {metrics.debt_to_equity:.2f}")
            elif metrics.debt_to_equity > 1.0:
                components["elevated_debt"] = 1
                notes.append(f"Elevated debt/equity: {metrics.debt_to_equity:.2f}")

        # Interest coverage
        if metrics.interest_coverage is not None:
            if metrics.interest_coverage < 1.5:
                components["low_interest_coverage"] = 2
                notes.append(f"Low interest coverage: {metrics.interest_coverage:.2f}x")
            elif metrics.interest_coverage < 3.0:
                components["moderate_interest_coverage"] = 1

        # Liquidity
        if metrics.current_ratio is not None:
            if metrics.current_ratio < 1.0:
                components["low_current_ratio"] = 1
                notes.append(f"Low current ratio: {metrics.current_ratio:.2f}")

        # Process qualitative factors
        if qualitative_factors:
            for factor, present in qualitative_factors.items():
                if present and factor in self.RISK_POINTS:
                    components[factor] = self.RISK_POINTS[factor]

        # Calculate total
        total_score = sum(components.values())

        # Determine risk level
        risk_level = self._score_to_level(total_score)

        return RiskScore(
            total_score=total_score,
            risk_level=risk_level,
            components=components,
            disqualifiers=disqualifiers,
            notes=notes,
        )

    def _check_disqualifiers(self, metrics: RiskMetrics) -> list[str]:
        """Check for automatic disqualifiers."""
        disqualifiers = []

        # Negative FCF for 3+ years
        if metrics.fcf_negative_years >= 3:
            disqualifiers.append(
                f"Negative free cash flow for {metrics.fcf_negative_years} consecutive years"
            )

        # Revenue decline for 2+ years
        if metrics.revenue_decline_years >= 2:
            disqualifiers.append(
                f"Revenue decline for {metrics.revenue_decline_years} consecutive years"
            )

        # Extreme debt
        if metrics.debt_to_ebitda is not None and metrics.debt_to_ebitda > 5.0:
            disqualifiers.append(f"Debt/EBITDA ratio {metrics.debt_to_ebitda:.1f}x exceeds 5x limit")

        return disqualifiers

    def _score_to_level(self, score: int) -> str:
        """Convert numeric score to risk level."""
        for (low, high), level in self.RISK_LEVELS.items():
            if low <= score <= high:
                return level
        return "VERY_HIGH"

    def extract_metrics_from_data(
        self,
        csv_data: dict[str, pd.DataFrame],
    ) -> RiskMetrics:
        """
        Extract risk metrics from company CSV data.

        Args:
            csv_data: Dictionary of DataFrames from CSV files

        Returns:
            RiskMetrics populated from available data
        """
        metrics = RiskMetrics()

        # Try to get metrics from key_metrics file
        key_metrics = csv_data.get("fundamentals/key_metrics")
        if key_metrics is not None and not key_metrics.empty:
            recent = key_metrics.iloc[-1]  # Most recent

            if "debt_to_equity" in recent:
                metrics.debt_to_equity = recent["debt_to_equity"]
            if "current_ratio" in recent:
                metrics.current_ratio = recent["current_ratio"]

        # Check for balance sheet data
        balance_sheet = csv_data.get("fundamentals/balance_sheet")
        if balance_sheet is not None and not balance_sheet.empty:
            recent = balance_sheet.iloc[-1]
            # Calculate debt/equity if not already available
            if metrics.debt_to_equity is None:
                total_debt = recent.get("long_term_debt", 0) + recent.get("short_term_debt", 0)
                equity = recent.get("shareholders_equity", 0)
                if equity and equity > 0:
                    metrics.debt_to_equity = total_debt / equity

        # Check cash flow trends
        cash_flow = csv_data.get("fundamentals/cash_flow")
        if cash_flow is not None and not cash_flow.empty:
            if "free_cash_flow" in cash_flow.columns:
                fcf_series = cash_flow["free_cash_flow"].dropna()
                # Count consecutive negative years (from most recent)
                negative_count = 0
                for fcf in reversed(fcf_series.tolist()):
                    if fcf < 0:
                        negative_count += 1
                    else:
                        break
                metrics.fcf_negative_years = negative_count

            if "operating_cash_flow" in cash_flow.columns:
                ocf_series = cash_flow["operating_cash_flow"].dropna()
                metrics.operating_cash_flow_positive_years = (ocf_series > 0).sum()

        # Check revenue trends
        income = csv_data.get("fundamentals/income_statement")
        if income is not None and not income.empty:
            if "revenue" in income.columns:
                revenue = income["revenue"].dropna()
                if len(revenue) >= 2:
                    # Count consecutive decline years
                    decline_count = 0
                    for i in range(len(revenue) - 1, 0, -1):
                        if revenue.iloc[i] < revenue.iloc[i - 1]:
                            decline_count += 1
                        else:
                            break
                    metrics.revenue_decline_years = decline_count

        return metrics

    def get_risk_adjustment(self, risk_level: str) -> float:
        """
        Get position size adjustment multiplier for risk level.

        Args:
            risk_level: Risk level string

        Returns:
            Multiplier (1.0 = no adjustment)
        """
        adjustments = {
            "LOW": 1.0,
            "MODERATE": 0.75,
            "HIGH": 0.50,
            "VERY_HIGH": 0.25,
        }
        return adjustments.get(risk_level.upper(), 0.5)

    def should_avoid(self, risk_score: RiskScore) -> bool:
        """
        Determine if investment should be avoided based on risk.

        Args:
            risk_score: Calculated risk score

        Returns:
            True if investment should be avoided
        """
        # Avoid if any disqualifiers
        if risk_score.disqualifiers:
            return True

        # Avoid if very high risk
        if risk_score.risk_level == "VERY_HIGH":
            return True

        return False

    def format_risk_report(self, risk_score: RiskScore) -> str:
        """
        Format risk score as human-readable report.

        Args:
            risk_score: Risk score to format

        Returns:
            Formatted report string
        """
        lines = [
            f"## Risk Assessment",
            f"",
            f"**Total Risk Score:** {risk_score.total_score} ({risk_score.risk_level})",
            f"",
        ]

        if risk_score.disqualifiers:
            lines.append("### Automatic Disqualifiers")
            for d in risk_score.disqualifiers:
                lines.append(f"- {d}")
            lines.append("")

        if risk_score.components:
            lines.append("### Risk Components")
            for component, points in risk_score.components.items():
                component_name = component.replace("_", " ").title()
                lines.append(f"- {component_name}: +{points} points")
            lines.append("")

        if risk_score.notes:
            lines.append("### Notes")
            for note in risk_score.notes:
                lines.append(f"- {note}")

        return "\n".join(lines)
