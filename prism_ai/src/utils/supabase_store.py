"""Minimal Supabase (PostgREST) client for the prism data layer.

Lets the Python pipeline store generated ticker data + research documents in
Supabase and read them back, instead of the local ``data/`` folder. Uses only
the standard library (urllib), matching the Ollama client's dependency-free style.

Credentials are forwarded from AlphaOS via env (the run route merges .env.local):
    NEXT_PUBLIC_SUPABASE_URL   Supabase project URL
    SUPABASE_SERVICE_ROLE_KEY  Service-role key (bypasses RLS) — preferred
    NEXT_PUBLIC_SUPABASE_ANON_KEY  Fallback if no service-role key is set

Tables (see scripts/supabase-schema.sql):
    prism_ticker_data       (ticker, category, csv_content, rows)   unique(ticker, category)
    prism_ticker_documents  (ticker, filename, content_base64)      unique(ticker, filename)
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

logger = logging.getLogger(__name__)


class SupabaseStore:
    """Thin PostgREST wrapper for the prism ticker-data / documents tables."""

    def __init__(self, url: Optional[str] = None, key: Optional[str] = None):
        self.url = (url or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
        self.key = (
            key
            or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
            or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
            or ""
        )

    def is_configured(self) -> bool:
        return bool(self.url and self.key)

    # ------------------------------------------------------------------ #
    # HTTP helpers
    # ------------------------------------------------------------------ #

    def _headers(self, extra: Optional[dict] = None) -> dict:
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }
        if extra:
            headers.update(extra)
        return headers

    def _request(self, method: str, path: str, body: Any = None, headers: Optional[dict] = None) -> Any:
        if not self.is_configured():
            raise RuntimeError(
                "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and "
                "SUPABASE_SERVICE_ROLE_KEY (forwarded from AlphaOS .env.local)."
            )
        url = f"{self.url}/rest/v1/{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(url, data=data, headers=self._headers(headers), method=method)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase {method} {path} failed ({e.code}): {detail}") from e

    def _upsert(self, table: str, rows: list[dict], on_conflict: str) -> None:
        if not rows:
            return
        query = urllib.parse.urlencode({"on_conflict": on_conflict})
        self._request(
            "POST",
            f"{table}?{query}",
            body=rows,
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )

    # ------------------------------------------------------------------ #
    # Ticker CSV data
    # ------------------------------------------------------------------ #

    def upsert_ticker_data(self, ticker: str, category: str, csv_content: str, rows: int) -> None:
        """Store one CSV (e.g. category 'fundamentals/revenue') for a ticker."""
        self._upsert(
            "prism_ticker_data",
            [{
                "ticker": ticker.upper(),
                "category": category,
                "csv_content": csv_content,
                "rows": rows,
            }],
            on_conflict="ticker,category",
        )

    def get_ticker_data(self, ticker: str) -> dict[str, str]:
        """Return {category: csv_content} for a ticker (empty if none)."""
        query = urllib.parse.urlencode({
            "ticker": f"eq.{ticker.upper()}",
            "select": "category,csv_content",
        })
        result = self._request("GET", f"prism_ticker_data?{query}")
        return {row["category"]: row["csv_content"] for row in (result or [])}

    def list_tickers(self) -> list[str]:
        """Distinct tickers that have any stored data."""
        result = self._request("GET", "prism_ticker_data?select=ticker")
        return sorted({row["ticker"] for row in (result or [])})

    # ------------------------------------------------------------------ #
    # Analysis recommendations (pipeline output)
    # ------------------------------------------------------------------ #

    def upsert_recommendation(self, row: dict) -> None:
        """Store one parsed analysis result (keyed by source_file)."""
        self._upsert("prism_recommendations", [row], on_conflict="source_file")

    # ------------------------------------------------------------------ #
    # Research documents (PDFs as base64)
    # ------------------------------------------------------------------ #

    def upsert_document(self, ticker: str, filename: str, content_base64: str) -> None:
        self._upsert(
            "prism_ticker_documents",
            [{"ticker": ticker.upper(), "filename": filename, "content_base64": content_base64}],
            on_conflict="ticker,filename",
        )

    def get_documents(self, ticker: str) -> list[dict[str, str]]:
        """Return [{filename, content_base64}, ...] for a ticker."""
        query = urllib.parse.urlencode({
            "ticker": f"eq.{ticker.upper()}",
            "select": "filename,content_base64",
        })
        return self._request("GET", f"prism_ticker_documents?{query}") or []
