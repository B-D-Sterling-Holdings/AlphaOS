"""
Configuration for the macro regime allocation system.
Two assets: equities and T-bills (fed funds rate proxy).

Loads user-facing settings from config.yaml, with Python defaults as fallback.
"""

import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import yaml


def _load_yaml() -> dict:
    """Load config.yaml from the same directory as this file."""
    yaml_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.yaml")
    if os.path.exists(yaml_path):
        with open(yaml_path) as f:
            return yaml.safe_load(f) or {}
    return {}


_Y = _load_yaml()


@dataclass
class Config:
    # ── Date range ──────────────────────────────────────────────────────
    start_date: str = _Y.get("start_date", "2000-01-01")
    end_date: str = _Y.get("end_date", "2026-03-01")

    # ── Asset proxies ───────────────────────────────────────────────────
    equity_ticker: str = _Y.get("equity_ticker", "SPY")

    asset_tickers: Dict[str, str] = field(default_factory=lambda: {
        "equity": _Y.get("equity_ticker", "SPY"),
    })

    vix_ticker: str = "^VIX"
    vix3m_ticker: str = "^VIX3M"

    tbills_rate_series: str = "fed_funds"

    # ── FRED series IDs ─────────────────────────────────────────────────
    fred_series: Dict[str, str] = field(default_factory=lambda: {
        "cpi":              "CPIAUCSL",
        "core_cpi":         "CPILFESL",
        "unemployment":     "UNRATE",
        "treasury_10y":     "DGS10",
        "treasury_2y":      "DGS2",
        "fed_funds":        "FEDFUNDS",
        # Baa corporate bond yield minus 10Y Treasury. Daily, full history from
        # 1986. Replaces ICE BofA HY OAS (BAMLH0A0HYM2), which FRED now truncates
        # to only ~3 recent years due to ICE historical-data licensing.
        "credit_spread":    "BAA10Y",
        "industrial_prod":  "INDPRO",
    })

    fred_revisable_series: List[str] = field(default_factory=lambda: [
        "cpi", "core_cpi", "unemployment", "industrial_prod",
    ])

    fred_api_key: Optional[str] = field(
        default_factory=lambda: os.environ.get("FRED_API_KEY")
    )

    # ── Forecast & rebalance ────────────────────────────────────────────
    forecast_horizon_months: int = _Y.get("forecast_horizon_months", 1)
    rebalance_frequency: str = "M"

    # ── Feature engineering ─────────────────────────────────────────────
    macro_lag_months: int = _Y.get("macro_lag_months", 1)
    zscore_window: int = 60
    momentum_window: int = _Y.get("momentum_window", 3)
    volatility_window: int = _Y.get("volatility_window", 3)

    # ── Model ───────────────────────────────────────────────────────────
    regularization_C: float = _Y.get("regularization_C", 0.5)
    class_weight: Optional[str] = _Y.get("class_weight", None)
    max_iter: int = _Y.get("max_iter", 1000)
    recency_halflife_months: int = _Y.get("recency_halflife_months", 18)

    # ── Backtest ────────────────────────────────────────────────────────
    holdout_start: Optional[str] = _Y.get("holdout_start", None)
    window_type: str = _Y.get("window_type", "expanding")
    rolling_window_months: int = _Y.get("rolling_window_months", 120)
    min_train_months: int = _Y.get("min_train_months", 36)

    # ── Allocation ──────────────────────────────────────────────────────
    min_weight: float = _Y.get("min_weight", 0.05)
    max_weight: float = _Y.get("max_weight", 0.95)
    confidence_blend: bool = True
    equal_weight: List[float] = field(default_factory=lambda: [
        _Y.get("baseline_equity", 0.75),
        _Y.get("baseline_tbills", 0.25),
    ])

    allocation_steepness: float = _Y.get("allocation_steepness", 10.0)

    weight_smoothing_up: float = _Y.get("weight_smoothing_up", 0.7)
    weight_smoothing_down: float = _Y.get("weight_smoothing_down", 1.0)

    # Crash overlay
    crash_overlay: bool = _Y.get("crash_overlay", True)
    vix_spike_threshold: float = _Y.get("vix_spike_threshold", 10.0)
    drawdown_defense_threshold: float = _Y.get("drawdown_defense_threshold", -15.0)
    credit_spike_threshold: float = _Y.get("credit_spike_threshold", 1.5)

    @property
    def data_start_date(self) -> str:
        """Backdate start_date so the model has enough training data and
        predictions begin AT start_date.  Accounts for min_train_months,
        forecast horizon, macro lag, feature-engineering lookback, and
        late-starting FRED series (credit spread BAA10Y starts Jan 1986)."""
        import pandas as pd
        dt = pd.Timestamp(self.start_date)
        # 12 = YoY inflation lookback, 3 = credit_spread diff(3),
        # 6 = extra buffer for late-starting FRED series
        feature_warmup = 12 + 3 + 6
        backdate = (self.min_train_months + self.forecast_horizon_months
                    + self.macro_lag_months + feature_warmup)
        return (dt - pd.DateOffset(months=backdate)).strftime("%Y-%m-%d")


    # ── Paths ───────────────────────────────────────────────────────────
    data_dir: str = "data"
    output_dir: str = "outputs"
    plot_dir: str = "outputs/plots"
    model_path: str = "outputs/model.joblib"

    # ── Asset class names (order matters) ───────────────────────────────
    asset_classes: List[str] = field(
        default_factory=lambda: ["equity", "tbills"]
    )
    class_labels: Dict[int, str] = field(
        default_factory=lambda: {0: "equity", 1: "tbills"}
    )
