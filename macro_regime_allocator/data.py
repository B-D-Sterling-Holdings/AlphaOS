"""
Data pipeline: download, feature engineering, and label construction.

Downloads SPY, VIX, and FRED macro series, engineers lagged features,
and builds forward-looking labels for the regime classifier.
"""

import os
import pandas as pd
import numpy as np
from config import Config


# ── Download ────────────────────────────────────────────────────────────────

def _download_asset_prices(cfg: Config) -> pd.DataFrame:
    import yfinance as yf

    tickers = list(cfg.asset_tickers.values())
    names = list(cfg.asset_tickers.keys())

    raw = yf.download(tickers, start=cfg.data_start_date, end=cfg.end_date,
                      auto_adjust=True, progress=False)

    if len(tickers) == 1:
        daily_close = raw[["Close"]].copy()
        daily_close.columns = [names[0]]
    else:
        daily_close = raw["Close"].copy()
        daily_close.rename(columns={v: k for k, v in cfg.asset_tickers.items()}, inplace=True)

    # Compute intramonth max drawdown from daily closes before resampling
    def _month_max_dd(group):
        cummax = group.cummax()
        return (group / cummax - 1).min()

    prices = daily_close.resample("ME").last()
    for name in names:
        monthly_dd = daily_close[name].resample("ME").apply(_month_max_dd) * 100
        prices[f"{name}_intramonth_dd"] = monthly_dd

    prices.index.name = "date"
    return prices


def _download_vix_data(cfg: Config) -> pd.DataFrame:
    import yfinance as yf

    vix_data = pd.DataFrame()

    for ticker, col in [(cfg.vix_ticker, "vix"), (cfg.vix3m_ticker, "vix3m")]:
        try:
            raw = yf.download(ticker, start=cfg.data_start_date, end=cfg.end_date,
                              auto_adjust=True, progress=False)
            vix_data[col] = raw["Close"].resample("ME").last()
            print(f"  Downloaded {col.upper()}: {len(vix_data[col].dropna())} monthly obs")
        except Exception as e:
            print(f"  WARNING: Could not download {col.upper()}: {e}")

    vix_data.index.name = "date"
    return vix_data


def _download_fred_data(cfg: Config) -> pd.DataFrame:
    """Download macro series from FRED. Uses ALFRED first-release for revisable series."""
    from fredapi import Fred

    if not cfg.fred_api_key:
        raise ValueError("FRED_API_KEY not set.")

    fred = Fred(api_key=cfg.fred_api_key)
    series_dict = {}
    start = pd.Timestamp(cfg.data_start_date)
    end = pd.Timestamp(cfg.end_date)

    for name, series_id in cfg.fred_series.items():
        try:
            if name in cfg.fred_revisable_series:
                s = fred.get_series_first_release(series_id)
                s.index = pd.to_datetime(s.index)
                s = s[(s.index >= start) & (s.index <= end)]
                s = pd.to_numeric(s, errors="coerce")
                series_dict[name] = s
                print(f"  Downloaded {name} ({series_id}): {len(s)} obs [first-release]")
            else:
                s = fred.get_series(series_id, observation_start=start, observation_end=end)
                series_dict[name] = s
                print(f"  Downloaded {name} ({series_id}): {len(s)} obs")
        except Exception as e:
            print(f"  WARNING: Could not download {name} ({series_id}): {e}")

    if not series_dict:
        raise RuntimeError("No FRED series downloaded successfully.")

    macro = pd.DataFrame(series_dict)
    macro.index = pd.to_datetime(macro.index)
    macro = macro.resample("ME").last()
    macro.index.name = "date"
    return macro


def load_data(cfg: Config) -> pd.DataFrame:
    """Download all data, merge to monthly, save to disk."""
    print("Downloading asset prices...")
    prices = _download_asset_prices(cfg)
    print(f"  Prices shape: {prices.shape}")

    print("Downloading VIX data...")
    vix = _download_vix_data(cfg)
    print(f"  VIX shape: {vix.shape}")

    print("Downloading FRED macro data...")
    macro = _download_fred_data(cfg)
    print(f"  Macro shape: {macro.shape}")

    print("Merging and cleaning...")
    merged = prices.join(vix, how="outer").join(macro, how="outer")
    merged = merged.ffill().dropna(subset=["equity"], how="all")
    print(f"  Merged shape: {merged.shape}")

    os.makedirs(cfg.data_dir, exist_ok=True)
    merged.to_csv(os.path.join(cfg.data_dir, "merged_monthly.csv"))
    print(f"  Saved to {cfg.data_dir}/merged_monthly.csv")
    return merged


# ── Feature Engineering ─────────────────────────────────────────────────────

def engineer_features(df: pd.DataFrame, cfg: Config, extend_for_live: bool = False) -> pd.DataFrame:
    """Build the full feature matrix. All features lagged by macro_lag_months.

    The uniform 1-month lag serves two purposes:
      - Macro series (CPI, unemployment) aren't published until weeks later.
      - Market series (VIX, equity) at t-1 are PREDICTIVE of t+1 outcomes
        (momentum persistence, volatility clustering), whereas t=0 values
        describe damage that already happened this month.

    extend_for_live: when True, append `macro_lag_months` future month rows so
    the newest available data, once lagged, produces a feature row for the
    UPCOMING month. Without this, shift() pushes the latest month's data off the
    end of the index and the model can only ever predict for the last DATA month
    — never the next one. Used only for the live prediction; the backtest calls
    this with the default (un-extended) matrix so its universe and realized
    returns are unchanged.
    """
    print("Engineering features...")
    feats = pd.DataFrame(index=df.index)

    # Inflation
    cpi_col = "cpi" if "cpi" in df.columns else "core_cpi"
    if cpi_col in df.columns:
        cpi = df[cpi_col]
        feats["inflation_yoy"] = cpi.pct_change(12) * 100
        feats["inflation_impulse"] = ((cpi / cpi.shift(3)) ** 4 - 1) * 100 - feats["inflation_yoy"]

    # Labor
    if "unemployment" in df.columns:
        feats["unemployment_rate"] = df["unemployment"]

    # Rates & credit
    if "credit_spread" in df.columns:
        feats["credit_spread_level"] = df["credit_spread"]
        feats["credit_spread_3m_change"] = df["credit_spread"].diff(3)

    if "fed_funds" in df.columns and cpi_col in df.columns:
        feats["real_fed_funds"] = df["fed_funds"] - df[cpi_col].pct_change(12) * 100

    if "treasury_10y" in df.columns and "treasury_2y" in df.columns:
        feats["yield_curve_slope"] = df["treasury_10y"] - df["treasury_2y"]

    # VIX
    if "vix" in df.columns:
        feats["vix_1m_change"] = df["vix"].diff(1)
        if "vix3m" in df.columns:
            feats["vix_term_structure"] = (df["vix"] / df["vix3m"]).fillna(1.0)
        else:
            feats["vix_term_structure"] = 1.0
    else:
        print("  WARNING: No VIX data, skipping VIX features")

    # Equity
    if "equity" in df.columns:
        monthly_ret = df["equity"].pct_change()
        feats["equity_momentum_3m"] = df["equity"].pct_change(cfg.momentum_window) * 100
        feats["equity_vol_3m"] = monthly_ret.rolling(cfg.volatility_window).std() * np.sqrt(12) * 100
        rolling_high = df["equity"].rolling(12).max()
        feats["equity_drawdown_from_high"] = (df["equity"] / rolling_high - 1) * 100
        if "equity_intramonth_dd" in df.columns:
            feats["equity_intramonth_dd"] = df["equity_intramonth_dd"]

    # Optionally extend the index into the future so the newest month's data,
    # once shifted by the lag, lands on a real feature row for the next month.
    if extend_for_live and cfg.macro_lag_months > 0 and len(feats.index) > 0:
        future = pd.DatetimeIndex([
            feats.index[-1] + pd.offsets.MonthEnd(i)
            for i in range(1, cfg.macro_lag_months + 1)
        ])
        feats = feats.reindex(feats.index.append(future))

    # Lag all features
    feats = feats.shift(cfg.macro_lag_months).dropna(how="all")

    # The extended matrix is a transient view for the live prediction — don't
    # print/overwrite the canonical features.csv the backtest just wrote.
    if not extend_for_live:
        print(f"  Features ({len(feats.columns)}): {list(feats.columns)}")
        print(f"  Shape: {feats.shape}")
        os.makedirs(cfg.data_dir, exist_ok=True)
        feats.to_csv(os.path.join(cfg.data_dir, "features.csv"))
        print(f"  Saved to {cfg.data_dir}/features.csv")
    return feats


# ── Label Construction ──────────────────────────────────────────────────────

def build_labels(df: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    """Build labels: 0 = equity beat T-bills, 1 = T-bills won."""
    print("Building labels...")
    horizon = cfg.forecast_horizon_months

    if "equity" not in df.columns:
        raise ValueError("'equity' not found in data columns.")

    rate_col = cfg.tbills_rate_series
    if rate_col not in df.columns:
        raise ValueError(f"'{rate_col}' not found in data columns.")

    # Forward equity return
    fwd = pd.DataFrame(index=df.index)
    fwd["fwd_ret_equity"] = (df["equity"].shift(-horizon) / df["equity"] - 1) * 100

    # Forward T-bill return (compounded fed funds)
    monthly_rate = df[rate_col] / 100 / 12
    tbills_cum = pd.Series(np.nan, index=df.index)
    for i in range(len(df) - horizon):
        cum = 1.0
        for j in range(horizon):
            r = monthly_rate.iloc[i + j]
            if np.isnan(r):
                cum = np.nan
                break
            cum *= (1 + r)
        tbills_cum.iloc[i] = (cum - 1) * 100
    fwd["fwd_ret_tbills"] = tbills_cum

    # Label
    valid = fwd.dropna(how="any")
    labels = (valid["fwd_ret_tbills"] >= valid["fwd_ret_equity"]).astype(int)
    labels.name = "label"
    excess = (valid["fwd_ret_equity"] - valid["fwd_ret_tbills"]).rename("equity_excess_return")

    labeled = pd.concat([fwd, excess, labels], axis=1).dropna(subset=["label"])
    labeled["label"] = labeled["label"].astype(int)

    # Print distribution
    dist = labeled["label"].value_counts().sort_index()
    for idx, count in dist.items():
        print(f"  {cfg.class_labels[idx]:>10s}: {count:4d} ({count / len(labeled) * 100:.1f}%)")
    print(f"  Avg equity excess return ({horizon}m): {labeled['equity_excess_return'].mean():.2f}%")
    print(f"  Labeled dataset shape: {labeled.shape}")

    os.makedirs(cfg.data_dir, exist_ok=True)
    labeled.to_csv(os.path.join(cfg.data_dir, "labeled_dataset.csv"))
    print(f"  Saved to {cfg.data_dir}/labeled_dataset.csv")
    return labeled
