"""Context assembly for LLM analysis."""

import pandas as pd
from pathlib import Path
from typing import Any, Optional
import logging

from .token_manager import TokenManager
from .priority_ranker import PriorityRanker

logger = logging.getLogger(__name__)


class ContextAssembler:
    """Assemble financial data into LLM-ready context."""

    def __init__(
        self,
        max_tokens: int = 1000000,
        priority_order: Optional[list[str]] = None,
    ):
        """
        Initialize the context assembler.

        Args:
            max_tokens: Maximum tokens for context
            priority_order: Custom priority order for data sections
        """
        self.token_manager = TokenManager(max_tokens=max_tokens)
        self.priority_ranker = PriorityRanker(priority_order=priority_order)

    def assemble_context(
        self,
        ticker: str,
        csv_data: dict[str, pd.DataFrame],
        pdf_text: Optional[str] = None,
        analyst_notes: Optional[str] = None,
        include_summary: bool = True,
    ) -> str:
        """
        Assemble all data into a single context string.

        Args:
            ticker: Company ticker symbol
            csv_data: Dictionary of DataFrames from CSV files
            pdf_text: Extracted text from research PDF
            include_summary: Whether to include data summary section

        Returns:
            Assembled context string
        """
        sections = []

        # Header
        sections.append(f"# Company Analysis: {ticker}\n")

        # Summary section
        if include_summary:
            summary = self._create_data_summary(csv_data, pdf_text)
            sections.append(summary)

        # Process and prioritize data sections
        prioritized = self.priority_ranker.prioritize_dataframes(csv_data)

        for key, df, score in prioritized:
            if not self.priority_ranker.should_include(key, df):
                logger.debug(f"Skipping {key} due to insufficient data")
                continue

            section = self._format_dataframe_section(key, df)
            if section:
                sections.append(section)

        # Add PDF content if available
        if pdf_text:
            pdf_section = self._format_pdf_section(pdf_text)
            sections.append(pdf_section)

        # Add the analyst's own working thesis if available
        if analyst_notes:
            sections.append(self._format_analyst_section(analyst_notes))

        # Combine all sections
        full_context = "\n\n---\n\n".join(sections)

        # Check token budget and truncate if necessary
        if not self.token_manager.fits_in_context(full_context):
            logger.warning("Context exceeds token budget, truncating...")
            full_context = self._truncate_context(sections)

        usage = self.token_manager.get_usage_stats(full_context)
        logger.info(
            f"Assembled context: {usage['estimated_tokens']} tokens "
            f"({usage['usage_percent']:.1f}% of available)"
        )

        return full_context

    def _create_data_summary(
        self,
        csv_data: dict[str, pd.DataFrame],
        pdf_text: Optional[str],
    ) -> str:
        """Create a summary of available data."""
        lines = ["## Data Summary\n"]

        lines.append("### Available Data Files:")
        for key, df in csv_data.items():
            date_range = ""
            if "date" in df.columns and not df["date"].isna().all():
                min_date = df["date"].min()
                max_date = df["date"].max()
                if pd.notna(min_date) and pd.notna(max_date):
                    date_range = f" ({min_date.strftime('%Y-%m-%d')} to {max_date.strftime('%Y-%m-%d')})"
            lines.append(f"- {key}: {len(df)} rows{date_range}")

        if pdf_text:
            lines.append(f"- Research PDF: {len(pdf_text)} characters")
        else:
            lines.append("- Research PDF: Not available")

        return "\n".join(lines)

    def _format_dataframe_section(self, key: str, df: pd.DataFrame) -> str:
        """
        Format a DataFrame into a readable text section.

        Args:
            key: Section key/name
            df: DataFrame to format

        Returns:
            Formatted text section
        """
        title = key.replace("/", " - ").replace("_", " ").title()
        lines = [f"## {title}\n"]

        # Get recent data for display
        recent_df = self.priority_ranker.get_summary_statistics(df, top_n=20)

        # Format as markdown table
        if not recent_df.empty:
            # Format numeric columns
            formatted_df = recent_df.copy()
            for col in formatted_df.select_dtypes(include=["float"]).columns:
                formatted_df[col] = formatted_df[col].apply(
                    lambda x: f"{x:,.2f}" if pd.notna(x) else "N/A"
                )

            # Format date column
            if "date" in formatted_df.columns:
                formatted_df["date"] = formatted_df["date"].apply(
                    lambda x: x.strftime("%Y-%m-%d") if pd.notna(x) else "N/A"
                )

            # Create markdown table
            lines.append(formatted_df.to_markdown(index=False))

        return "\n".join(lines)

    def _format_pdf_section(self, pdf_text: str) -> str:
        """
        Format PDF text into a context section.

        Args:
            pdf_text: Extracted PDF text

        Returns:
            Formatted section
        """
        lines = [
            "## Research Document / News Summary\n",
            "The following is extracted from the company's research document:\n",
        ]

        # Truncate if too long
        max_pdf_tokens = 50000  # Reserve ~50k tokens for PDF
        if self.token_manager.estimate_tokens(pdf_text) > max_pdf_tokens:
            pdf_text = self.token_manager.truncate_to_fit(
                pdf_text, max_tokens=max_pdf_tokens
            )
            lines.append("*Note: Document truncated due to length.*\n")

        lines.append(pdf_text)
        return "\n".join(lines)

    def _format_analyst_section(self, notes: str) -> str:
        """Format the analyst's working thesis into a context section."""
        return (
            "## Analyst's Working Thesis\n"
            "The internal analyst has recorded the notes below for this name. "
            "Use them as additional context, but verify every claim against the "
            "financial data above — do not accept the analyst's conclusions "
            "uncritically.\n\n" + notes
        )

    def _truncate_context(self, sections: list[str]) -> str:
        """
        Truncate context to fit within token budget.

        Args:
            sections: List of context sections

        Returns:
            Truncated context string
        """
        available = self.token_manager.available_tokens()

        # Keep header and summary (first two sections)
        result = []
        used_tokens = 0

        for i, section in enumerate(sections):
            section_tokens = self.token_manager.estimate_tokens(section)

            if used_tokens + section_tokens <= available:
                result.append(section)
                used_tokens += section_tokens
            elif i < 2:
                # Always keep header and summary
                result.append(section)
                used_tokens += section_tokens
            else:
                # Truncate remaining content
                remaining = available - used_tokens
                if remaining > 100:  # Only add if meaningful space left
                    truncated = self.token_manager.truncate_to_fit(
                        section, max_tokens=remaining
                    )
                    result.append(truncated)
                break

        return "\n\n---\n\n".join(result)

    def create_minimal_context(
        self,
        ticker: str,
        csv_data: dict[str, pd.DataFrame],
        pdf_text: Optional[str] = None,
    ) -> str:
        """
        Create a minimal context with only the most important data.

        Useful for testing or when working with smaller token budgets.

        Args:
            ticker: Company ticker symbol
            csv_data: Dictionary of DataFrames
            pdf_text: Optional PDF text

        Returns:
            Minimal context string
        """
        sections = [f"# Company Analysis: {ticker}\n"]

        # Include only most recent financials and ratios
        priority_keys = [
            "fundamentals/income_statement",
            "fundamentals/key_metrics",
            "ratios/valuation_ratios",
        ]

        for key in priority_keys:
            if key in csv_data:
                df = csv_data[key]
                # Get only last 4 periods
                recent = self.priority_ranker.get_summary_statistics(df, top_n=4)
                if not recent.empty:
                    section = self._format_dataframe_section(key, recent)
                    sections.append(section)

        # Add truncated PDF if available
        if pdf_text:
            truncated_pdf = self.token_manager.truncate_to_fit(
                pdf_text, max_tokens=10000
            )
            sections.append(f"## Research Summary\n\n{truncated_pdf}")

        return "\n\n---\n\n".join(sections)

    def get_context_stats(self, context: str) -> dict:
        """
        Get statistics about assembled context.

        Args:
            context: Assembled context string

        Returns:
            Dictionary of statistics
        """
        stats = self.token_manager.get_usage_stats(context)
        stats["section_count"] = context.count("## ")
        stats["table_count"] = context.count("|---")
        return stats


def _plain_text(value: Any) -> str:
    """Coerce a workspace field to plain text.

    Fields written by RichTextArea may be either a string or a list of blocks
    ``[{"type": "text", "value": "..."}, ...]``; both are flattened here.
    """
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts = []
        for block in value:
            if isinstance(block, dict) and block.get("type") == "text":
                text = block.get("value")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
        return "\n".join(parts).strip()
    return ""


def format_analyst_notes(thesis: Optional[dict]) -> str:
    """Render an analyst ``theses`` row into a markdown notes block.

    Returns an empty string when there is nothing worth sending, so callers can
    simply check truthiness. Mirrors the Research workspace structure
    (companyOverview, fundamentals boxes, due-diligence / dislocation Q&A,
    narrative) defined in src/app/api/thesis/[ticker]/route.js.
    """
    if not thesis:
        return ""

    parts: list[str] = []
    underwriting = thesis.get("underwriting") or {}

    overview = _plain_text(underwriting.get("companyOverview"))
    if overview:
        parts.append(f"### Company Overview\n{overview}")

    workspace = underwriting.get("researchWorkspace") or {}

    note = _plain_text(workspace.get("note"))
    if note:
        parts.append(f"### Why this name is in research\n{note}")

    fundamentals = workspace.get("fundamentals") or {}
    fundamental_lines = []
    for key, label in (
        ("revenueGrowth", "Revenue & Growth"),
        ("profitability", "Profitability"),
        ("capitalReturn", "Capital Returned to Shareholders"),
        ("misc", "Misc"),
    ):
        text = _plain_text(fundamentals.get(key))
        if text:
            fundamental_lines.append(f"- **{label}:** {text}")
    if fundamental_lines:
        parts.append("### Analyst's Fundamental Notes\n" + "\n".join(fundamental_lines))

    for field, label in (
        ("dueDiligenceItems", "Due Diligence Questions"),
        ("dislocationItems", "Dislocation Questions"),
    ):
        items = workspace.get(field) or []
        q_lines = []
        for item in items:
            if not isinstance(item, dict):
                continue
            question = _plain_text(item.get("text"))
            answer = _plain_text(item.get("answer"))
            if not question and not answer:
                continue
            q_lines.append(f"- Q: {question or '(no question text)'}\n  A: {answer or '(unanswered)'}")
        if q_lines:
            parts.append(f"### {label}\n" + "\n".join(q_lines))

    narrative = _plain_text(thesis.get("assumptions"))
    if narrative:
        parts.append(f"### Analyst Narrative\n{narrative}")

    return "\n\n".join(parts)
