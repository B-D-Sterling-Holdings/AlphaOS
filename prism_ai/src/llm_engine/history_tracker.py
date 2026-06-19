"""Historical Tracking for LLM Recommendations.

This module tracks how recommendations change over time for each ticker,
allowing users to see:
- Signal changes (BUY → HOLD → SELL)
- Conviction level trends
- Price target evolution
- When the AI "changed its mind"

Data is stored in outputs/history/ as JSON files per ticker.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Optional, List, Dict

logger = logging.getLogger(__name__)


@dataclass
class HistoryEntry:
    """A single point in the recommendation history."""

    timestamp: str  # ISO format datetime
    signal: str  # BUY, HOLD, AVOID
    conviction: str  # VERY_HIGH, HIGH, MODERATE, LOW
    position_size_pct: Optional[float]
    price_target: Optional[float]
    expected_return_pct: Optional[float]
    model: str
    analysis_file: str  # Reference to the full analysis file

    # Computed fields
    signal_changed: bool = False  # True if signal differs from previous
    conviction_changed: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "HistoryEntry":
        return cls(
            timestamp=data["timestamp"],
            signal=data["signal"],
            conviction=data["conviction"],
            position_size_pct=data.get("position_size_pct"),
            price_target=data.get("price_target"),
            expected_return_pct=data.get("expected_return_pct"),
            model=data.get("model", "unknown"),
            analysis_file=data.get("analysis_file", ""),
            signal_changed=data.get("signal_changed", False),
            conviction_changed=data.get("conviction_changed", False),
        )


@dataclass
class TickerHistory:
    """Complete history for a single ticker."""

    ticker: str
    entries: List[HistoryEntry]
    first_analysis: str  # ISO datetime
    last_analysis: str  # ISO datetime
    total_analyses: int
    signal_changes: int  # Number of times signal changed
    current_signal: str
    current_conviction: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ticker": self.ticker,
            "entries": [e.to_dict() for e in self.entries],
            "first_analysis": self.first_analysis,
            "last_analysis": self.last_analysis,
            "total_analyses": self.total_analyses,
            "signal_changes": self.signal_changes,
            "current_signal": self.current_signal,
            "current_conviction": self.current_conviction,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TickerHistory":
        entries = [HistoryEntry.from_dict(e) for e in data.get("entries", [])]
        return cls(
            ticker=data["ticker"],
            entries=entries,
            first_analysis=data.get("first_analysis", ""),
            last_analysis=data.get("last_analysis", ""),
            total_analyses=data.get("total_analyses", len(entries)),
            signal_changes=data.get("signal_changes", 0),
            current_signal=data.get("current_signal", ""),
            current_conviction=data.get("current_conviction", ""),
        )


class HistoryTracker:
    """Tracks recommendation history for all tickers."""

    def __init__(self, history_dir: Optional[Path] = None, recommendations_dir: Optional[Path] = None):
        """
        Initialize the history tracker.

        Args:
            history_dir: Directory to store history files
            recommendations_dir: Directory containing analysis JSON files
        """
        if history_dir is None:
            history_dir = Path(__file__).parent.parent.parent / "outputs" / "history"
        if recommendations_dir is None:
            recommendations_dir = Path(__file__).parent.parent.parent / "outputs" / "recommendations"

        self.history_dir = Path(history_dir)
        self.recommendations_dir = Path(recommendations_dir)
        self.history_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"History tracker initialized: {self.history_dir}")

    def _normalize_signal(self, signal: Optional[str]) -> str:
        """Normalize signal to standard format."""
        if not signal:
            return "UNKNOWN"
        signal = signal.strip().upper()
        if signal == "SELL":
            return "AVOID"
        return signal

    def _get_history_file(self, ticker: str) -> Path:
        """Get path to history file for a ticker."""
        return self.history_dir / f"{ticker.upper()}_history.json"

    def load_history(self, ticker: str) -> Optional[TickerHistory]:
        """Load history for a ticker from disk."""
        history_file = self._get_history_file(ticker)
        if not history_file.exists():
            return None

        try:
            data = json.loads(history_file.read_text())
            return TickerHistory.from_dict(data)
        except (json.JSONDecodeError, KeyError) as e:
            logger.warning(f"Error loading history for {ticker}: {e}")
            return None

    def save_history(self, history: TickerHistory) -> None:
        """Save history for a ticker to disk."""
        history_file = self._get_history_file(history.ticker)
        history_file.write_text(json.dumps(history.to_dict(), indent=2))
        logger.info(f"Saved history for {history.ticker}: {len(history.entries)} entries")

    def build_history_from_analyses(self, ticker: str) -> TickerHistory:
        """
        Build history for a ticker by scanning all analysis files.

        This reads all *_analysis.json files and extracts the recommendation
        history, detecting signal changes along the way.
        """
        ticker = ticker.upper()
        entries: List[HistoryEntry] = []

        # Find all analysis files for this ticker
        pattern = f"*_{ticker}_analysis.json"
        analysis_files = sorted(self.recommendations_dir.glob(pattern))

        # Also check for files that might have different naming
        for f in self.recommendations_dir.glob("*_analysis.json"):
            try:
                data = json.loads(f.read_text())
                if data.get("ticker", "").upper() == ticker and f not in analysis_files:
                    analysis_files.append(f)
            except:
                pass

        # Sort by filename (which contains date)
        analysis_files = sorted(set(analysis_files))

        prev_signal = None
        prev_conviction = None
        signal_changes = 0

        for analysis_file in analysis_files:
            try:
                data = json.loads(analysis_file.read_text())
                rec = data.get("recommendation", {})

                signal = self._normalize_signal(rec.get("signal"))
                conviction = rec.get("conviction", "UNKNOWN")

                # Detect changes
                signal_changed = prev_signal is not None and signal != prev_signal
                conviction_changed = prev_conviction is not None and conviction != prev_conviction

                if signal_changed:
                    signal_changes += 1

                entry = HistoryEntry(
                    timestamp=data.get("analysis_date", analysis_file.stem[:8]),
                    signal=signal,
                    conviction=conviction,
                    position_size_pct=rec.get("position_size_pct"),
                    price_target=rec.get("price_target_12mo"),
                    expected_return_pct=rec.get("expected_return_pct"),
                    model=data.get("model", "unknown"),
                    analysis_file=analysis_file.name,
                    signal_changed=signal_changed,
                    conviction_changed=conviction_changed,
                )
                entries.append(entry)

                prev_signal = signal
                prev_conviction = conviction

            except (json.JSONDecodeError, KeyError) as e:
                logger.warning(f"Error reading {analysis_file}: {e}")
                continue

        # Sort entries by timestamp
        entries.sort(key=lambda e: e.timestamp)

        # Build history object
        history = TickerHistory(
            ticker=ticker,
            entries=entries,
            first_analysis=entries[0].timestamp if entries else "",
            last_analysis=entries[-1].timestamp if entries else "",
            total_analyses=len(entries),
            signal_changes=signal_changes,
            current_signal=entries[-1].signal if entries else "",
            current_conviction=entries[-1].conviction if entries else "",
        )

        # Save to disk
        self.save_history(history)

        return history

    def get_history(self, ticker: str, rebuild: bool = False) -> Optional[TickerHistory]:
        """
        Get history for a ticker.

        Args:
            ticker: Ticker symbol
            rebuild: If True, rebuild from analysis files even if cached

        Returns:
            TickerHistory or None if no data
        """
        ticker = ticker.upper()

        if not rebuild:
            history = self.load_history(ticker)
            if history:
                return history

        return self.build_history_from_analyses(ticker)

    def get_all_histories(self) -> List[TickerHistory]:
        """Get history for all tickers with analysis files."""
        tickers = set()

        # Find all tickers from analysis files
        for f in self.recommendations_dir.glob("*_analysis.json"):
            try:
                data = json.loads(f.read_text())
                ticker = data.get("ticker", "").upper()
                if ticker:
                    tickers.add(ticker)
            except:
                pass

        histories = []
        for ticker in sorted(tickers):
            history = self.get_history(ticker)
            if history:
                histories.append(history)

        return histories

    def get_signal_changes_summary(self) -> Dict[str, Any]:
        """Get a summary of signal changes across all tickers."""
        histories = self.get_all_histories()

        total_changes = sum(h.signal_changes for h in histories)
        tickers_with_changes = [h.ticker for h in histories if h.signal_changes > 0]

        # Recent changes (last entry where signal_changed is True)
        recent_changes = []
        for h in histories:
            for entry in reversed(h.entries):
                if entry.signal_changed:
                    recent_changes.append({
                        "ticker": h.ticker,
                        "timestamp": entry.timestamp,
                        "new_signal": entry.signal,
                        "conviction": entry.conviction,
                    })
                    break

        # Sort by timestamp descending
        recent_changes.sort(key=lambda x: x["timestamp"], reverse=True)

        return {
            "total_tickers_tracked": len(histories),
            "total_signal_changes": total_changes,
            "tickers_with_changes": tickers_with_changes,
            "recent_changes": recent_changes[:10],  # Last 10 changes
        }

    def get_timeline(self, ticker: str) -> List[Dict[str, Any]]:
        """
        Get a timeline view for a ticker suitable for visualization.

        Returns list of points with:
        - date
        - signal (as number for charting: BUY=1, HOLD=0, AVOID=-1)
        - conviction_score (VERY_HIGH=4, HIGH=3, MODERATE=2, LOW=1)
        - labels
        """
        history = self.get_history(ticker)
        if not history:
            return []

        signal_map = {"BUY": 1, "HOLD": 0, "AVOID": -1, "SELL": -1, "UNKNOWN": 0}
        conviction_map = {"VERY_HIGH": 4, "HIGH": 3, "MODERATE": 2, "LOW": 1, "UNKNOWN": 0}

        timeline = []
        for entry in history.entries:
            timeline.append({
                "date": entry.timestamp,
                "signal": entry.signal,
                "signal_value": signal_map.get(entry.signal, 0),
                "conviction": entry.conviction,
                "conviction_value": conviction_map.get(entry.conviction, 0),
                "position_size_pct": entry.position_size_pct,
                "price_target": entry.price_target,
                "signal_changed": entry.signal_changed,
                "model": entry.model,
            })

        return timeline


# Convenience function
def get_tracker(history_dir: Optional[Path] = None) -> HistoryTracker:
    """Get a history tracker instance."""
    return HistoryTracker(history_dir=history_dir)
