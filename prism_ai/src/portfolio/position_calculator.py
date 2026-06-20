"""Position size calculator based on conviction and risk."""

from dataclasses import dataclass
from typing import Optional
import logging

logger = logging.getLogger(__name__)


@dataclass
class PositionSizeResult:
    """Result of position size calculation."""

    base_size_pct: float
    risk_adjustment: float
    sector_adjustment: float
    final_size_pct: float
    capped: bool
    notes: list[str]


class PositionCalculator:
    """Calculate appropriate position sizes based on conviction and risk."""

    # Base position sizes by conviction level
    CONVICTION_SIZES = {
        "VERY_HIGH": (5.0, 7.0),
        "HIGH": (3.0, 5.0),
        "MODERATE": (1.0, 3.0),
        "LOW": (0.0, 1.0),
    }

    # Risk adjustments by risk level
    RISK_ADJUSTMENTS = {
        "LOW": 1.0,  # No reduction
        "MODERATE": 0.75,  # 25% reduction
        "HIGH": 0.50,  # 50% reduction
        "VERY_HIGH": 0.25,  # 75% reduction
    }

    # Maximum position constraints
    MAX_SINGLE_POSITION = 10.0
    MIN_POSITION = 0.5
    MAX_SECTOR_EXPOSURE = 25.0
    MAX_POSITIONS_PER_SECTOR = 3

    def __init__(
        self,
        portfolio_value: Optional[float] = None,
        existing_positions: Optional[dict[str, dict]] = None,
    ):
        """
        Initialize the position calculator.

        Args:
            portfolio_value: Total portfolio value (for absolute sizing)
            existing_positions: Dict of existing positions {ticker: {sector, size_pct}}
        """
        self.portfolio_value = portfolio_value
        self.existing_positions = existing_positions or {}

    def calculate_position_size(
        self,
        conviction: str,
        risk_level: str,
        sector: Optional[str] = None,
        volatility_adjustment: float = 1.0,
    ) -> PositionSizeResult:
        """
        Calculate recommended position size.

        Args:
            conviction: Conviction level (VERY_HIGH, HIGH, MODERATE, LOW)
            risk_level: Risk level (LOW, MODERATE, HIGH, VERY_HIGH)
            sector: Company sector for concentration checks
            volatility_adjustment: Multiplier for high-volatility stocks (< 1.0 reduces size)

        Returns:
            PositionSizeResult with sizing details
        """
        notes = []

        # Get base size from conviction
        conviction = conviction.upper()
        if conviction not in self.CONVICTION_SIZES:
            logger.warning(f"Unknown conviction level: {conviction}, using MODERATE")
            conviction = "MODERATE"

        min_size, max_size = self.CONVICTION_SIZES[conviction]
        base_size = (min_size + max_size) / 2  # Use midpoint
        notes.append(f"Base size from {conviction} conviction: {base_size:.1f}%")

        # Apply risk adjustment
        risk_level = risk_level.upper()
        if risk_level not in self.RISK_ADJUSTMENTS:
            logger.warning(f"Unknown risk level: {risk_level}, using MODERATE")
            risk_level = "MODERATE"

        risk_mult = self.RISK_ADJUSTMENTS[risk_level]
        if risk_mult < 1.0:
            notes.append(f"Risk adjustment ({risk_level}): {risk_mult:.0%}")

        # Apply volatility adjustment
        vol_adjustment = min(1.0, max(0.5, volatility_adjustment))
        if vol_adjustment < 1.0:
            notes.append(f"Volatility adjustment: {vol_adjustment:.0%}")

        # Calculate sector adjustment
        sector_mult = self._calculate_sector_adjustment(sector)
        if sector_mult < 1.0:
            notes.append(f"Sector concentration adjustment: {sector_mult:.0%}")

        # Calculate final size
        final_size = base_size * risk_mult * vol_adjustment * sector_mult

        # Apply caps
        capped = False
        if final_size > self.MAX_SINGLE_POSITION:
            notes.append(f"Capped at maximum {self.MAX_SINGLE_POSITION}%")
            final_size = self.MAX_SINGLE_POSITION
            capped = True

        if final_size < self.MIN_POSITION and final_size > 0:
            notes.append(f"Below minimum {self.MIN_POSITION}%, rounding to 0")
            final_size = 0

        return PositionSizeResult(
            base_size_pct=base_size,
            risk_adjustment=risk_mult,
            sector_adjustment=sector_mult,
            final_size_pct=round(final_size, 2),
            capped=capped,
            notes=notes,
        )

    def _calculate_sector_adjustment(self, sector: Optional[str]) -> float:
        """
        Calculate sector concentration adjustment.

        Args:
            sector: Company sector

        Returns:
            Multiplier (1.0 = no adjustment, < 1.0 = reduce)
        """
        if sector is None or not self.existing_positions:
            return 1.0

        # Count existing positions in sector
        sector_positions = sum(
            1 for pos in self.existing_positions.values()
            if pos.get("sector", "").upper() == sector.upper()
        )

        # Calculate current sector exposure
        sector_exposure = sum(
            pos.get("size_pct", 0)
            for pos in self.existing_positions.values()
            if pos.get("sector", "").upper() == sector.upper()
        )

        # Apply adjustments
        if sector_positions >= self.MAX_POSITIONS_PER_SECTOR:
            logger.info(f"Already {sector_positions} positions in {sector}, reducing by 50%")
            return 0.5

        if sector_exposure >= self.MAX_SECTOR_EXPOSURE * 0.8:
            logger.info(f"Sector {sector} near exposure limit, reducing by 25%")
            return 0.75

        return 1.0

    def calculate_absolute_size(
        self,
        position_size_pct: float,
        current_price: Optional[float] = None,
    ) -> dict:
        """
        Calculate absolute position size in dollars and shares.

        Args:
            position_size_pct: Position size as portfolio percentage
            current_price: Current stock price for share calculation

        Returns:
            Dictionary with dollar amount and share count
        """
        if self.portfolio_value is None:
            return {
                "dollar_amount": None,
                "share_count": None,
                "note": "Portfolio value not set",
            }

        dollar_amount = self.portfolio_value * (position_size_pct / 100)

        result = {
            "dollar_amount": round(dollar_amount, 2),
            "share_count": None,
        }

        if current_price and current_price > 0:
            result["share_count"] = int(dollar_amount / current_price)

        return result

    def get_conviction_range(self, conviction: str) -> tuple[float, float]:
        """
        Get the position size range for a conviction level.

        Args:
            conviction: Conviction level

        Returns:
            Tuple of (min_size, max_size)
        """
        return self.CONVICTION_SIZES.get(conviction.upper(), (0.0, 1.0))

    def validate_position_size(
        self,
        size_pct: float,
        signal: str,
        conviction: str,
    ) -> list[str]:
        """
        Validate a proposed position size.

        Args:
            size_pct: Proposed position size percentage
            signal: Trading signal (BUY, HOLD, SELL, AVOID)
            conviction: Conviction level

        Returns:
            List of validation warnings
        """
        warnings = []

        # Check maximum
        if size_pct > self.MAX_SINGLE_POSITION:
            warnings.append(f"Position {size_pct}% exceeds maximum {self.MAX_SINGLE_POSITION}%")

        # Check minimum
        if 0 < size_pct < self.MIN_POSITION:
            warnings.append(f"Position {size_pct}% below minimum {self.MIN_POSITION}%")

        # Check consistency with signal
        if signal.upper() in ("SELL", "AVOID") and size_pct > 0:
            warnings.append(f"{signal} signal should have 0% position size")

        if signal.upper() == "BUY" and size_pct == 0:
            warnings.append("BUY signal with 0% position size")

        # Check consistency with conviction
        min_size, max_size = self.get_conviction_range(conviction)
        if size_pct > max_size:
            warnings.append(
                f"Position {size_pct}% exceeds max {max_size}% for {conviction} conviction"
            )

        return warnings

    def summarize_portfolio(self) -> dict:
        """
        Get summary of current portfolio allocations.

        Returns:
            Dictionary with portfolio summary
        """
        if not self.existing_positions:
            return {"total_allocated": 0, "positions": 0, "sectors": {}}

        total = sum(p.get("size_pct", 0) for p in self.existing_positions.values())

        sectors = {}
        for ticker, pos in self.existing_positions.items():
            sector = pos.get("sector", "Unknown")
            if sector not in sectors:
                sectors[sector] = {"count": 0, "total_pct": 0}
            sectors[sector]["count"] += 1
            sectors[sector]["total_pct"] += pos.get("size_pct", 0)

        return {
            "total_allocated": round(total, 2),
            "cash_pct": round(100 - total, 2),
            "positions": len(self.existing_positions),
            "sectors": sectors,
        }
