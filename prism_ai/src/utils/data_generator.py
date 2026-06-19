"""Generate data/ CSVs for a ticker using Alpha Vantage (fundamentals) and yfinance (prices)."""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

import pandas as pd

from .supabase_store import SupabaseStore

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # Optional dependency

try:
    import yfinance as yf
except Exception as exc:  # pragma: no cover - runtime environment dependent
    raise RuntimeError("yfinance is required for price data generation") from exc


ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query"


def _quarter_label(dt: pd.Timestamp) -> str:
    quarter = ((dt.month - 1) // 3) + 1
    return f"Q{quarter}"


def _quarter_frame(series: pd.Series, value_name: str) -> pd.DataFrame:
    df = pd.DataFrame({value_name: series.values}, index=series.index)
    df["year"] = df.index.year
    df["quarter"] = df.index.map(_quarter_label)
    return df[["year", "quarter", value_name]]


def _ttm_sum(series: pd.Series) -> pd.Series:
    return series.sort_index().rolling(4).sum()


def _ttm_mean(series: pd.Series) -> pd.Series:
    return series.sort_index().rolling(4).mean()


# --- Alpha Vantage API Functions ---


def _fetch_alpha_vantage(function: str, symbol: str, api_key: str) -> dict:
    """Fetch data from Alpha Vantage API."""
    url = f"{ALPHA_VANTAGE_BASE_URL}?function={function}&symbol={symbol}&apikey={api_key}"
    try:
        with urlopen(url, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError) as e:
        raise RuntimeError(f"Alpha Vantage API request failed: {e}") from e

    # Check for API errors
    if "Error Message" in data:
        raise RuntimeError(f"Alpha Vantage API error: {data['Error Message']}")
    if "Note" in data:
        # Rate limit hit
        raise RuntimeError(f"Alpha Vantage rate limit: {data['Note']}")
    if "Information" in data:
        raise RuntimeError(f"Alpha Vantage: {data['Information']}")

    return data


def _parse_quarterly_reports(data: dict, report_key: str = "quarterlyReports") -> pd.DataFrame:
    """Parse Alpha Vantage quarterly reports into a DataFrame."""
    reports = data.get(report_key, [])
    if not reports:
        return pd.DataFrame()

    df = pd.DataFrame(reports)
    if "fiscalDateEnding" not in df.columns:
        return pd.DataFrame()

    # Convert fiscalDateEnding to datetime index
    df["fiscalDateEnding"] = pd.to_datetime(df["fiscalDateEnding"])
    df = df.set_index("fiscalDateEnding")
    df = df.sort_index()

    # Convert numeric columns (Alpha Vantage returns strings)
    for col in df.columns:
        if col != "reportedCurrency":
            df[col] = pd.to_numeric(df[col], errors="coerce")

    return df


def _fetch_income_statement(symbol: str, api_key: str) -> pd.DataFrame:
    """Fetch quarterly income statement data from Alpha Vantage."""
    data = _fetch_alpha_vantage("INCOME_STATEMENT", symbol, api_key)
    return _parse_quarterly_reports(data)


def _fetch_balance_sheet(symbol: str, api_key: str) -> pd.DataFrame:
    """Fetch quarterly balance sheet data from Alpha Vantage."""
    data = _fetch_alpha_vantage("BALANCE_SHEET", symbol, api_key)
    return _parse_quarterly_reports(data)


def _fetch_cash_flow(symbol: str, api_key: str) -> pd.DataFrame:
    """Fetch quarterly cash flow data from Alpha Vantage."""
    data = _fetch_alpha_vantage("CASH_FLOW", symbol, api_key)
    return _parse_quarterly_reports(data)


def _pick_series(df: pd.DataFrame, names: list[str]) -> Optional[pd.Series]:
    """Pick the first available column from a list of possible names."""
    if df.empty:
        return None
    for name in names:
        if name in df.columns:
            series = df[name].astype("float64")
            if not series.isna().all():
                return series
    return None


# --- Price Data (yfinance) ---


def _download_prices(ticker: str, years: int) -> pd.DataFrame:
    """Download price data using yfinance."""
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=365 * years + 10)
    price = yf.download(
        ticker,
        start=start.isoformat(),
        end=end.isoformat(),
        auto_adjust=False,
        progress=False,
        group_by="column",
    )
    if price.empty:
        return price
    if isinstance(price.columns, pd.MultiIndex):
        price.columns = [c[0] if c[0] else c[1] for c in price.columns]
    price = price.reset_index()
    price.columns = [str(c).lower().replace(" ", "_") for c in price.columns]
    price = price.rename(columns={"adj_close": "adjusted_close"})
    if "date" not in price.columns and "datetime" in price.columns:
        price = price.rename(columns={"datetime": "date"})
    return price


# --- Main Generation Function ---


def generate_data(ticker: str, data_dir: Path | None = None, years: int = 5, api_key: Optional[str] = None) -> list[str]:
    """Generate price + fundamentals data for a ticker and store it in Supabase.

    Uses Alpha Vantage for fundamental data (5 years of quarterly history) and
    yfinance for price data. Each dataset is upserted into ``prism_ticker_data``
    (one row per category) rather than written to the local ``data/`` folder.
    """
    # Get API key
    if api_key is None:
        api_key = os.environ.get("ALPHA_VANTAGE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "Alpha Vantage API key required. Set ALPHA_VANTAGE_API_KEY environment variable "
            "or pass --api-key argument. Get a free key at: https://www.alphavantage.co/support/#api-key"
        )

    store = SupabaseStore()
    if not store.is_configured():
        raise RuntimeError(
            "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY so generated data can be stored."
        )

    ticker_up = ticker.upper()
    stored: list[str] = []

    def emit(category: str, frame: pd.DataFrame) -> None:
        store.upsert_ticker_data(ticker_up, category, frame.to_csv(index=False), len(frame))
        stored.append(category)

    # Prices (from yfinance - unlimited and reliable)
    print(f"Fetching price data for {ticker}...")
    price = _download_prices(ticker, years)
    if price.empty:
        raise RuntimeError(f"No price data returned for {ticker}")
    if "date" not in price.columns:
        raise RuntimeError(f"Unexpected price columns: {price.columns}")
    if "close" not in price.columns:
        close_candidates = [
            c for c in price.columns if "close" in c and c != "adjusted_close"
        ]
        if close_candidates:
            price = price.rename(columns={close_candidates[0]: "close"})
        else:
            raise RuntimeError(f"Close column not found in price data: {price.columns}")
    price["date"] = pd.to_datetime(price["date"]).dt.strftime("%Y-%m-%d")
    price_cols = ["date", "close"]
    price = price[[c for c in price_cols if c in price.columns]]
    emit("price_data/daily_prices", price)
    print(f"  Saved {len(price)} days of price data")

    # Calculate market data metrics (52-week high/low, current price, etc.)
    print("Calculating market data metrics...")
    price_numeric = price.copy()
    price_numeric["date"] = pd.to_datetime(price_numeric["date"])
    price_numeric = price_numeric.sort_values("date")

    # Get the most recent price
    current_price = float(price_numeric.iloc[-1]["close"])
    current_date = price_numeric.iloc[-1]["date"].strftime("%Y-%m-%d")

    # Calculate 52-week high and low (last 252 trading days ≈ 1 year)
    last_year_prices = price_numeric.tail(252)
    week_52_high = float(last_year_prices["close"].max())
    week_52_low = float(last_year_prices["close"].min())

    # Calculate percentage from 52-week high
    pct_from_high = ((current_price - week_52_high) / week_52_high) * 100

    # Calculate 1-year price change (252 trading days ago vs now)
    price_1y_ago = None
    pct_change_1y = None
    if len(price_numeric) >= 252:
        price_1y_ago = float(price_numeric.iloc[-252]["close"])
        pct_change_1y = ((current_price - price_1y_ago) / price_1y_ago) * 100

    # Create market data summary
    market_data_rows = [{
        "metric": "current_price",
        "value": current_price,
        "date": current_date
    }, {
        "metric": "52_week_high",
        "value": week_52_high,
        "date": current_date
    }, {
        "metric": "52_week_low",
        "value": week_52_low,
        "date": current_date
    }, {
        "metric": "pct_from_52week_high",
        "value": round(pct_from_high, 2),
        "date": current_date
    }]

    if pct_change_1y is not None:
        market_data_rows.append({
            "metric": "pct_change_1y",
            "value": round(pct_change_1y, 2),
            "date": current_date
        })

    market_data = pd.DataFrame(market_data_rows)
    emit("price_data/market_data", market_data)
    print(f"  Saved market data: Current ${current_price:.2f}, 52W High ${week_52_high:.2f} ({pct_from_high:+.1f}%), 1Y Change: {pct_change_1y:+.1f}%" if pct_change_1y else f"  Saved market data: Current ${current_price:.2f}, 52W High ${week_52_high:.2f} ({pct_from_high:+.1f}%)")

    # Fundamentals from Alpha Vantage (5 years of quarterly data)
    print("Fetching fundamental data from Alpha Vantage...")

    # Fetch all three statements (with rate limiting pauses)
    print("  Fetching income statement...")
    income = _fetch_income_statement(ticker, api_key)
    time.sleep(12)  # Alpha Vantage free tier: max 1 request per 12 seconds (5 per minute)

    print("  Fetching balance sheet...")
    balance = _fetch_balance_sheet(ticker, api_key)
    time.sleep(12)

    print("  Fetching cash flow statement...")
    cash = _fetch_cash_flow(ticker, api_key)

    print(f"  Retrieved {len(income)} quarters of income data")
    print(f"  Retrieved {len(balance)} quarters of balance sheet data")
    print(f"  Retrieved {len(cash)} quarters of cash flow data")

    # Extract series from Alpha Vantage data
    # Alpha Vantage field names (camelCase)
    revenue = _pick_series(income, ["totalRevenue", "Total Revenue"])
    operating_income = _pick_series(income, ["operatingIncome", "Operating Income"])
    net_income = _pick_series(income, ["netIncome", "Net Income", "netIncomeFromContinuingOperations"])
    shares_out = _pick_series(
        balance,
        ["commonStockSharesOutstanding", "Common Stock Shares Outstanding", "commonStock"],
    )

    eps = _pick_series(income, ["dilutedEPS", "reportedEPS", "Diluted EPS", "Reported EPS"])

    # Calculate EPS if not directly available
    if eps is None:
        diluted_shares = _pick_series(
            income,
            [
                "dilutedAverageShares",
                "dilutedAverageSharesOutstanding",
                "Diluted Average Shares",
            ],
        )
        if net_income is not None and diluted_shares is not None:
            eps = net_income / diluted_shares
        elif net_income is not None and shares_out is not None:
            eps = net_income / shares_out

    # Free cash flow
    fcf = _pick_series(cash, ["freeCashFlow", "Free Cash Flow"])
    if fcf is None:
        op_cf = _pick_series(cash, ["operatingCashflow", "Operating Cashflow"])
        capex = _pick_series(cash, ["capitalExpenditures", "Capital Expenditures"])
        if op_cf is not None and capex is not None:
            # capex is reported as positive in Alpha Vantage, so we subtract it
            fcf = op_cf - capex

    quarters = years * 4

    # Save fundamental data
    if revenue is not None:
        ttm_revenue = _ttm_sum(revenue).dropna().tail(quarters)
        if not ttm_revenue.empty:
            emit("fundamentals/revenue", _quarter_frame(ttm_revenue, "revenue"))
            print(f"  Saved {len(ttm_revenue)} quarters of revenue data")

    if operating_income is not None and revenue is not None:
        ttm_op = _ttm_sum(operating_income)
        ttm_rev = _ttm_sum(revenue)
        op_margin = (ttm_op / ttm_rev).dropna().tail(quarters)
        if not op_margin.empty:
            emit("fundamentals/operating_margins", _quarter_frame(op_margin, "operating_margin"))
            print(f"  Saved {len(op_margin)} quarters of margin data")

    if shares_out is not None:
        shares_ttm = _ttm_mean(shares_out).dropna().tail(quarters)
        if not shares_ttm.empty:
            emit("fundamentals/buybacks", _quarter_frame(shares_ttm, "shares_outstanding"))
            print(f"  Saved {len(shares_ttm)} quarters of shares data")

    if eps is not None:
        eps_ttm = _ttm_sum(eps).dropna().tail(quarters)
        if not eps_ttm.empty:
            emit("fundamentals/eps", _quarter_frame(eps_ttm, "eps_diluted"))
            print(f"  Saved {len(eps_ttm)} quarters of EPS data")

    if fcf is not None:
        fcf_ttm = _ttm_sum(fcf).dropna().tail(quarters)
        if not fcf_ttm.empty:
            emit("fundamentals/fcf", _quarter_frame(fcf_ttm, "free_cash_flow"))
            print(f"  Saved {len(fcf_ttm)} quarters of FCF data")

    return stored


def main() -> int:
    # Load environment variables from .env file if available
    if load_dotenv is not None:
        load_dotenv()

    parser = argparse.ArgumentParser(
        description="Generate data/ CSVs using Alpha Vantage (fundamentals) and yfinance (prices)."
    )
    parser.add_argument("--ticker", "-t", required=True, help="Ticker symbol (e.g., NFLX)")
    parser.add_argument(
        "--data-dir",
        default="data",
        help="Root data directory (default: data)",
    )
    parser.add_argument(
        "--years",
        type=int,
        default=5,
        help="Number of years of TTM history (default: 5)",
    )
    parser.add_argument(
        "--api-key",
        help="Alpha Vantage API key (or set ALPHA_VANTAGE_API_KEY env var)",
    )
    args = parser.parse_args()

    stored = generate_data(args.ticker, years=args.years, api_key=args.api_key)
    print(f"\nStored {len(stored)} dataset(s) for {args.ticker.upper()} in Supabase: {', '.join(stored)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
