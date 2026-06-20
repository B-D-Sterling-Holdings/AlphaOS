"""CSV Parser for loading financial data (Supabase-backed, disk fallback)."""

import io
import logging
from pathlib import Path
from typing import Optional

import pandas as pd

from ..utils.supabase_store import SupabaseStore

logger = logging.getLogger(__name__)


class CSVParser:
    """Load financial data for a company.

    Primary source is Supabase (``prism_ticker_data``, one row per CSV, keyed by
    ``ticker`` + ``category`` like ``fundamentals/revenue``). If Supabase has no
    data for a ticker, it falls back to the local ``data/<ticker>/`` folder so the
    bundled sample tickers keep working before they are migrated.
    """

    FUNDAMENTALS_FILES = {
        "revenue",
        "operating_margins",
        "buybacks",
        "eps",
        "fcf",
    }
    PRICE_FILES = {"daily_prices", "market_data"}
    RATIO_FILES = {"valuation_ratios"}
    VALUATION_FILES = {"valuation"}

    CATEGORY_ALLOWLIST = {
        "fundamentals": FUNDAMENTALS_FILES,
        "price_data": PRICE_FILES,
        "ratios": RATIO_FILES,
        "valuation": VALUATION_FILES,
    }

    def __init__(self, data_dir: Path | str, store: Optional[SupabaseStore] = None):
        """
        Args:
            data_dir: Root directory for the local-disk fallback
            store: SupabaseStore (defaults to one built from env)
        """
        self.data_dir = Path(data_dir)
        self.store = store or SupabaseStore()

    # ------------------------------------------------------------------ #
    # Loading
    # ------------------------------------------------------------------ #

    def _is_allowed(self, category: str) -> bool:
        cat, _, stem = category.partition("/")
        return cat in self.CATEGORY_ALLOWLIST and stem in self.CATEGORY_ALLOWLIST[cat]

    def load_company_data(self, ticker: str) -> dict[str, pd.DataFrame]:
        """Load all supported CSV data for a company (Supabase first, disk fallback)."""
        ticker = ticker.upper()

        # 1) Supabase
        if self.store.is_configured():
            try:
                rows = self.store.get_ticker_data(ticker)
            except Exception as e:
                logger.warning(f"Supabase read failed for {ticker}: {e}; trying local data/")
                rows = {}
            if rows:
                data = {}
                for category, content in rows.items():
                    if not self._is_allowed(category):
                        logger.debug(f"Skipping unsupported category: {category}")
                        continue
                    data[category] = self._load_csv_text(content)
                logger.info(f"Loaded {len(data)} CSV datasets for {ticker} from Supabase")
                return data
            logger.info(f"No Supabase data for {ticker}; falling back to local data/")

        # 2) Local-disk fallback
        return self._load_from_disk(ticker)

    def _load_from_disk(self, ticker: str) -> dict[str, pd.DataFrame]:
        company_dir = self.data_dir / ticker
        if not company_dir.exists():
            raise FileNotFoundError(f"No data found for {ticker} (Supabase or local data/)")

        data = {}
        for category, allowed in self.CATEGORY_ALLOWLIST.items():
            sub_dir = company_dir / category
            if not sub_dir.exists():
                continue
            for csv_file in sub_dir.glob("*.csv"):
                if csv_file.stem not in allowed:
                    logger.debug(f"Skipping unsupported file: {csv_file.name}")
                    continue
                data[f"{category}/{csv_file.stem}"] = self._load_csv(csv_file)

        logger.info(f"Loaded {len(data)} CSV files for {ticker} from local data/")
        return data

    def _process_frame(self, df: pd.DataFrame) -> pd.DataFrame:
        """Apply date/quarter parsing and numeric coercion (shared by all sources)."""
        # Try to parse date column if present
        if "date" in df.columns:
            df["date"] = pd.to_datetime(df["date"], errors="coerce")
            df = df.sort_values("date", ascending=True)
        elif "year" in df.columns and "quarter" in df.columns:
            # Support quarter-based fundamentals (Q1-Q4 or 1-4)
            year = pd.to_numeric(df["year"], errors="coerce")
            quarter_raw = df["quarter"].astype(str).str.strip().str.upper()
            quarter_num = pd.to_numeric(quarter_raw.str.replace("Q", "", regex=False), errors="coerce")
            df["quarter"] = quarter_num.map({1: "Q1", 2: "Q2", 3: "Q3", 4: "Q4"})

            month_map = {1: 3, 2: 6, 3: 9, 4: 12}
            month = quarter_num.map(month_map)
            df["date"] = pd.to_datetime(
                {"year": year, "month": month, "day": 1},
                errors="coerce",
            ) + pd.offsets.MonthEnd(0)
            df = df.sort_values("date", ascending=True)

        # Convert numeric columns
        for col in df.columns:
            if col not in {"date", "quarter"}:
                df[col] = pd.to_numeric(df[col], errors="coerce")

        return df

    def _load_csv_text(self, content: str) -> pd.DataFrame:
        """Parse a CSV string (Supabase source)."""
        try:
            df = pd.read_csv(io.StringIO(content))
            return self._process_frame(df)
        except Exception as e:
            logger.error(f"Error parsing CSV content: {e}")
            raise

    def _load_csv(self, file_path: Path) -> pd.DataFrame:
        """Load a single CSV file from disk (fallback source)."""
        try:
            df = pd.read_csv(file_path)
            df = self._process_frame(df)
            logger.debug(f"Loaded {file_path.name}: {len(df)} rows")
            return df
        except Exception as e:
            logger.error(f"Error loading {file_path}: {e}")
            raise

    def load_specific_file(
        self, ticker: str, category: str, filename: str
    ) -> Optional[pd.DataFrame]:
        """Load a specific dataset (Supabase first, disk fallback)."""
        if category in self.CATEGORY_ALLOWLIST and filename not in self.CATEGORY_ALLOWLIST[category]:
            logger.warning(f"Unsupported file requested: {category}/{filename}")
            return None

        key = f"{category}/{filename}"
        if self.store.is_configured():
            try:
                rows = self.store.get_ticker_data(ticker)
                if key in rows:
                    return self._load_csv_text(rows[key])
            except Exception as e:
                logger.warning(f"Supabase read failed for {ticker}/{key}: {e}")

        file_path = self.data_dir / ticker / category / f"{filename}.csv"
        if not file_path.exists():
            logger.warning(f"File not found: {file_path}")
            return None
        return self._load_csv(file_path)

    # ------------------------------------------------------------------ #
    # Discovery
    # ------------------------------------------------------------------ #

    def get_available_tickers(self) -> list[str]:
        """Tickers with data (Supabase ∪ local data/ for unmigrated samples)."""
        tickers = set()
        if self.store.is_configured():
            try:
                tickers.update(self.store.list_tickers())
            except Exception as e:
                logger.warning(f"Supabase ticker list failed: {e}")
        if self.data_dir.exists():
            for item in self.data_dir.iterdir():
                if item.is_dir() and not item.name.startswith("."):
                    tickers.add(item.name)
        return sorted(tickers)

    def get_data_summary(self, ticker: str) -> dict:
        """Summary of available data for a ticker (file counts + date ranges)."""
        try:
            data = self.load_company_data(ticker)
        except FileNotFoundError as e:
            return {"error": str(e)}

        summary = {"ticker": ticker.upper(), "files": {}, "date_ranges": {}}
        for key, df in data.items():
            summary["files"][key] = {"rows": len(df), "columns": list(df.columns)}
            if "date" in df.columns and not df["date"].isna().all():
                summary["date_ranges"][key] = {
                    "min": df["date"].min().isoformat() if pd.notna(df["date"].min()) else None,
                    "max": df["date"].max().isoformat() if pd.notna(df["date"].max()) else None,
                }
        return summary
