"""Priority ranking for data sections in context assembly."""

import pandas as pd
from datetime import datetime, timedelta
from typing import Optional
import logging

logger = logging.getLogger(__name__)


class PriorityRanker:
    """Rank and prioritize data sections for context assembly."""

    # Default priority order (highest to lowest)
    DEFAULT_PRIORITY = [
        "fundamentals",
        "valuation_ratios",
        "research_pdf",
        "price_data",
    ]

    # Category mappings for file keys
    CATEGORY_MAP = {
        "fundamentals/revenue": "fundamentals",
        "fundamentals/operating_margins": "fundamentals",
        "fundamentals/buybacks": "fundamentals",
        "fundamentals/eps": "fundamentals",
        "fundamentals/fcf": "fundamentals",
        "ratios/valuation_ratios": "valuation_ratios",
        "price_data/daily_prices": "price_data",
        "research_pdf": "research_pdf",
    }

    def __init__(self, priority_order: Optional[list[str]] = None):
        """
        Initialize the priority ranker.

        Args:
            priority_order: Custom priority order (highest to lowest)
        """
        self.priority_order = priority_order or self.DEFAULT_PRIORITY

    def get_category(self, file_key: str) -> str:
        """
        Get the category for a file key.

        Args:
            file_key: Key identifying the data file

        Returns:
            Category name
        """
        return self.CATEGORY_MAP.get(file_key, "other")

    def get_priority_score(self, file_key: str) -> int:
        """
        Get priority score for a file key (lower = higher priority).

        Args:
            file_key: Key identifying the data file

        Returns:
            Priority score (0 = highest priority)
        """
        category = self.get_category(file_key)
        try:
            return self.priority_order.index(category)
        except ValueError:
            return len(self.priority_order)  # Lowest priority

    def rank_sections(self, sections: dict[str, str]) -> list[tuple[str, str, int]]:
        """
        Rank sections by priority.

        Args:
            sections: Dictionary mapping section keys to content

        Returns:
            List of (key, content, priority_score) tuples sorted by priority
        """
        ranked = []
        for key, content in sections.items():
            score = self.get_priority_score(key)
            ranked.append((key, content, score))

        ranked.sort(key=lambda x: x[2])
        return ranked

    def filter_by_recency(
        self,
        df: pd.DataFrame,
        days: int = 1825,  # 5 years
        date_column: str = "date",
    ) -> pd.DataFrame:
        """
        Filter DataFrame to recent data.

        Args:
            df: DataFrame to filter
            days: Number of days to include
            date_column: Name of date column

        Returns:
            Filtered DataFrame
        """
        if date_column not in df.columns:
            return df

        if df[date_column].isna().all():
            return df

        cutoff = datetime.now() - timedelta(days=days)
        mask = df[date_column] >= cutoff
        filtered = df[mask].copy()

        if len(filtered) == 0:
            # If no recent data, return most recent N rows
            logger.warning(f"No data within {days} days, returning most recent 20 rows")
            return df.tail(20)

        return filtered

    def calculate_data_relevance(
        self,
        df: pd.DataFrame,
        date_column: str = "date",
    ) -> float:
        """
        Calculate relevance score for a DataFrame based on recency.

        Args:
            df: DataFrame to evaluate
            date_column: Name of date column

        Returns:
            Relevance score (0.0 to 1.0)
        """
        if date_column not in df.columns or df.empty:
            return 0.5  # Neutral score

        if df[date_column].isna().all():
            return 0.5

        # Get most recent date
        most_recent = df[date_column].max()
        if pd.isna(most_recent):
            return 0.5

        # Calculate age in days
        age_days = (datetime.now() - pd.Timestamp(most_recent).to_pydatetime()).days

        # Exponential decay with 365-day half-life
        relevance = 0.5 ** (age_days / 365)
        return min(1.0, max(0.0, relevance))

    def prioritize_dataframes(
        self,
        data: dict[str, pd.DataFrame],
        filter_recent: bool = True,
        recent_days: int = 1825,
    ) -> list[tuple[str, pd.DataFrame, float]]:
        """
        Prioritize DataFrames by category and recency.

        Args:
            data: Dictionary mapping keys to DataFrames
            filter_recent: Whether to filter to recent data
            recent_days: Number of days for recency filter

        Returns:
            List of (key, dataframe, score) tuples sorted by priority
        """
        results = []

        for key, df in data.items():
            # Apply recency filter if requested
            if filter_recent:
                df = self.filter_by_recency(df, days=recent_days)

            # Calculate combined score (lower = better)
            priority_score = self.get_priority_score(key)
            relevance = self.calculate_data_relevance(df)

            # Combined score: priority + (1 - relevance)
            # Lower priority number + higher relevance = lower combined score
            combined_score = priority_score + (1 - relevance)

            results.append((key, df, combined_score))

        results.sort(key=lambda x: x[2])
        return results

    def get_summary_statistics(
        self, df: pd.DataFrame, top_n: int = 4
    ) -> pd.DataFrame:
        """
        Get most recent rows for summary statistics.

        Args:
            df: DataFrame to summarize
            top_n: Number of recent rows to include

        Returns:
            DataFrame with top N most recent rows
        """
        if "date" in df.columns and not df["date"].isna().all():
            df = df.sort_values("date", ascending=False)
        return df.head(top_n)

    def should_include(
        self,
        key: str,
        df: pd.DataFrame,
        min_rows: int = 1,
        max_nan_ratio: float = 0.8,
    ) -> bool:
        """
        Determine if a data section should be included.

        Args:
            key: Data section key
            df: DataFrame to evaluate
            min_rows: Minimum rows required
            max_nan_ratio: Maximum NaN ratio allowed

        Returns:
            True if section should be included
        """
        if df.empty or len(df) < min_rows:
            return False

        # Check if too many NaN values
        numeric_cols = df.select_dtypes(include=["number"]).columns
        if len(numeric_cols) > 0:
            nan_ratio = df[numeric_cols].isna().mean().mean()
            if nan_ratio > max_nan_ratio:
                logger.debug(f"Excluding {key}: NaN ratio {nan_ratio:.2%}")
                return False

        return True
