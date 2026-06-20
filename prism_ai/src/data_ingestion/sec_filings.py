"""Fetch and parse SEC EDGAR filings (10-K / 10-Q).

This module pulls the most recent annual (10-K) and quarterly (10-Q) reports for
a ticker straight from SEC EDGAR's public JSON + Archives endpoints, then carves
out the *business-understanding* parts:

  - From the 10-K: **Item 1. Business** (the primary source for a company
    overview), with **Item 1A. Risk Factors** kept separately as light context.
  - From the 10-Q: **Item 2. Management's Discussion & Analysis** (recent
    operating commentary, segment/risk updates), capped to keep token use sane.

Only the Python standard library is used (``urllib``, ``html.parser``) so no new
dependency is added. SEC requires a descriptive User-Agent on every request.
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Optional
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

# SEC asks for a User-Agent identifying the application + a contact address.
# Override via env if you want your own contact on it (see SECFilingsFetcher).
DEFAULT_USER_AGENT = "AlphaOS Research (research@alphaos.local)"

TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
ARCHIVE_DOC_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{accn}/{doc}"

# Hard caps so a huge filing can't blow up the LLM context window. Item 1 of a
# 10-K is usually well under this; the 10-Q MD&A is trimmed harder.
MAX_ITEM1_CHARS = 120_000
MAX_RISK_CHARS = 40_000
MAX_TENQ_CHARS = 80_000


class _TextExtractor(HTMLParser):
    """Minimal HTML -> text converter (stdlib only).

    Drops script/style, turns block-level tags into newlines, and decodes
    entities. Good enough to run section regexes over a filing's body.
    """

    _BLOCK_TAGS = {"p", "div", "br", "tr", "li", "table", "h1", "h2", "h3", "h4", "h5", "h6"}
    _SKIP_TAGS = {"script", "style", "head"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP_TAGS:
            self._skip_depth += 1
        elif tag in self._BLOCK_TAGS:
            self._parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self._SKIP_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1
        elif tag in self._BLOCK_TAGS:
            self._parts.append("\n")

    def handle_data(self, data):
        if self._skip_depth == 0:
            self._parts.append(data)

    def get_text(self) -> str:
        text = "".join(self._parts)
        # Normalize non-breaking spaces and collapse runaway whitespace.
        text = text.replace("\xa0", " ")
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
        return text.strip()


def html_to_text(html: str) -> str:
    """Convert raw filing HTML into normalized plain text."""
    parser = _TextExtractor()
    try:
        parser.feed(html)
    except Exception as e:  # malformed HTML — keep whatever was parsed
        logger.warning(f"HTML parse warning: {e}")
    return parser.get_text()


@dataclass
class Filing:
    """One fetched filing with its extracted business sections."""

    form: str
    accession: str
    filing_date: str
    report_date: str
    url: str
    item1_business: str = ""
    item1a_risk: str = ""
    mdna: str = ""
    full_text_chars: int = 0
    sections_used: list[str] = field(default_factory=list)


@dataclass
class CompanyFilings:
    """The pair of filings used to build a company overview."""

    ticker: str
    cik: int
    company_name: str
    tenk: Optional[Filing] = None
    tenq: Optional[Filing] = None


class SECFilingsFetcher:
    """Resolve a ticker to its latest 10-K / 10-Q and extract business sections."""

    def __init__(self, user_agent: Optional[str] = None, request_delay: float = 0.2):
        self.user_agent = user_agent or DEFAULT_USER_AGENT
        # SEC rate limit is 10 req/s; a small delay keeps us comfortably under it.
        self.request_delay = request_delay
        self._ticker_map: Optional[dict[str, dict]] = None

    # ----- low-level HTTP -----------------------------------------------------
    def _get(self, url: str) -> bytes:
        headers = {"User-Agent": self.user_agent, "Accept-Encoding": "gzip, deflate"}
        req = Request(url, headers=headers)
        logger.debug(f"GET {url}")
        time.sleep(self.request_delay)
        with urlopen(req, timeout=30) as resp:
            data = resp.read()
            if resp.info().get("Content-Encoding") == "gzip":
                import gzip
                data = gzip.decompress(data)
        return data

    def _get_json(self, url: str) -> dict:
        return json.loads(self._get(url).decode("utf-8", errors="replace"))

    def _get_text(self, url: str) -> str:
        return self._get(url).decode("utf-8", errors="replace")

    # ----- ticker -> CIK ------------------------------------------------------
    def resolve_cik(self, ticker: str) -> tuple[int, str]:
        """Return (cik, company_name) for a ticker, or raise ValueError."""
        if self._ticker_map is None:
            raw = self._get_json(TICKER_MAP_URL)
            # raw is keyed by index: {"0": {"cik_str":..,"ticker":..,"title":..}}
            self._ticker_map = {
                str(row["ticker"]).upper(): row for row in raw.values()
            }
        row = self._ticker_map.get(ticker.upper())
        if not row:
            raise ValueError(f"Ticker {ticker!r} not found in SEC EDGAR company list")
        return int(row["cik_str"]), str(row.get("title", ticker))

    # ----- find latest filings -----------------------------------------------
    def _latest_filing_meta(self, cik: int, form: str) -> Optional[dict]:
        """Return metadata for the most recent filing of `form` (e.g. '10-K')."""
        data = self._get_json(SUBMISSIONS_URL.format(cik=cik))
        recent = data.get("filings", {}).get("recent", {})
        forms = recent.get("form", [])
        accns = recent.get("accessionNumber", [])
        docs = recent.get("primaryDocument", [])
        filed = recent.get("filingDate", [])
        reported = recent.get("reportDate", [])

        for i, f in enumerate(forms):
            # Match exact form only (skip amendments like 10-K/A unless nothing else).
            if f == form:
                return {
                    "accession": accns[i],
                    "primary_document": docs[i],
                    "filing_date": filed[i] if i < len(filed) else "",
                    "report_date": reported[i] if i < len(reported) else "",
                }
        # Fall back to amendments if no clean filing exists.
        for i, f in enumerate(forms):
            if f.startswith(form):
                return {
                    "accession": accns[i],
                    "primary_document": docs[i],
                    "filing_date": filed[i] if i < len(filed) else "",
                    "report_date": reported[i] if i < len(reported) else "",
                }
        return None

    def _fetch_document_text(self, cik: int, meta: dict) -> tuple[str, str]:
        """Return (document_url, plain_text) for a filing's primary document."""
        accn_nodash = meta["accession"].replace("-", "")
        url = ARCHIVE_DOC_URL.format(cik=cik, accn=accn_nodash, doc=meta["primary_document"])
        html = self._get_text(url)
        return url, html_to_text(html)

    # ----- section extraction -------------------------------------------------
    @staticmethod
    def _extract_section(text: str, start_pats: list[str], end_pats: list[str], cap: int) -> str:
        """Pull the body of a filing item.

        Filings repeat item headers in the table of contents, so for each
        candidate start we measure the span to the next end marker and keep the
        *longest* span — that's the real body, not the one-line TOC entry.
        """
        lower = text.lower()
        starts: list[int] = []
        for pat in start_pats:
            starts.extend(m.start() for m in re.finditer(pat, lower))
        if not starts:
            return ""

        best = ""
        for s in sorted(set(starts)):
            # Find the earliest end marker that comes after this start.
            end = len(text)
            for pat in end_pats:
                m = re.search(pat, lower[s + 20:])
                if m:
                    end = min(end, s + 20 + m.start())
            segment = text[s:end].strip()
            if len(segment) > len(best):
                best = segment
        return best[:cap].strip()

    def _extract_10k_sections(self, text: str) -> tuple[str, str]:
        item1 = self._extract_section(
            text,
            start_pats=[r"item\s*1\.?\s*[\.\:\-\s]*business\b", r"item\s*1\s*business\b"],
            end_pats=[
                r"item\s*1a\.?\s*[\.\:\-\s]*risk",
                r"item\s*1b\b",
                r"item\s*2\.?\s*[\.\:\-\s]*propert",
            ],
            cap=MAX_ITEM1_CHARS,
        )
        risk = self._extract_section(
            text,
            start_pats=[r"item\s*1a\.?\s*[\.\:\-\s]*risk\s*factors"],
            end_pats=[
                r"item\s*1b\b",
                r"item\s*2\.?\s*[\.\:\-\s]*propert",
                r"item\s*3\.?\s*[\.\:\-\s]*legal",
            ],
            cap=MAX_RISK_CHARS,
        )
        return item1, risk

    def _extract_10q_mdna(self, text: str) -> str:
        mdna = self._extract_section(
            text,
            start_pats=[
                r"item\s*2\.?\s*[\.\:\-\s]*management.s\s*discussion",
                r"management.s\s*discussion\s*and\s*analysis",
            ],
            # Bound MD&A by the items that follow it (Item 3 / Item 4). Avoid
            # "Part II" as an end marker: filings cross-reference it mid-MD&A
            # (e.g. "see Part II, Item 1A"), which would truncate the section.
            end_pats=[
                r"item\s*3\.?\s*[\.\:\-\s]*quantitative",
                r"item\s*4\.?\s*[\.\:\-\s]*controls",
            ],
            cap=MAX_TENQ_CHARS,
        )
        # If MD&A can't be located, fall back to a capped slice of the whole
        # filing so the model still has *something* recent to work with.
        return mdna or text[:MAX_TENQ_CHARS].strip()

    # ----- public entry point -------------------------------------------------
    def fetch_company_filings(self, ticker: str) -> CompanyFilings:
        """Fetch latest 10-K + 10-Q and extract their business sections."""
        cik, name = self.resolve_cik(ticker)
        logger.info(f"Resolved {ticker} -> CIK {cik} ({name})")
        result = CompanyFilings(ticker=ticker.upper(), cik=cik, company_name=name)

        tenk_meta = self._latest_filing_meta(cik, "10-K")
        if tenk_meta:
            url, text = self._fetch_document_text(cik, tenk_meta)
            item1, risk = self._extract_10k_sections(text)
            used = []
            if item1:
                used.append("Item 1. Business")
            if risk:
                used.append("Item 1A. Risk Factors")
            result.tenk = Filing(
                form="10-K",
                accession=tenk_meta["accession"],
                filing_date=tenk_meta["filing_date"],
                report_date=tenk_meta["report_date"],
                url=url,
                item1_business=item1,
                item1a_risk=risk,
                full_text_chars=len(text),
                sections_used=used,
            )
            logger.info(
                f"10-K {tenk_meta['accession']} filed {tenk_meta['filing_date']}: "
                f"Item 1 = {len(item1)} chars, Item 1A = {len(risk)} chars"
            )
        else:
            logger.warning(f"No 10-K found for {ticker}")

        tenq_meta = self._latest_filing_meta(cik, "10-Q")
        if tenq_meta:
            url, text = self._fetch_document_text(cik, tenq_meta)
            mdna = self._extract_10q_mdna(text)
            result.tenq = Filing(
                form="10-Q",
                accession=tenq_meta["accession"],
                filing_date=tenq_meta["filing_date"],
                report_date=tenq_meta["report_date"],
                url=url,
                mdna=mdna,
                full_text_chars=len(text),
                sections_used=["Item 2. Management's Discussion & Analysis"] if mdna else [],
            )
            logger.info(
                f"10-Q {tenq_meta['accession']} filed {tenq_meta['filing_date']}: "
                f"MD&A = {len(mdna)} chars"
            )
        else:
            logger.warning(f"No 10-Q found for {ticker}")

        return result

    # ----- prompt context assembly -------------------------------------------
    @staticmethod
    def build_filing_context(filings: CompanyFilings) -> str:
        """Render fetched filings into a labeled context block for the LLM."""
        parts = [
            f"Company: {filings.company_name}",
            f"Ticker: {filings.ticker}",
            f"SEC CIK: {filings.cik}",
            "",
        ]

        if filings.tenk:
            k = filings.tenk
            parts.append("=" * 70)
            parts.append(
                f"PRIMARY SOURCE — FORM 10-K (annual report)\n"
                f"Filed: {k.filing_date} | Period: {k.report_date} | "
                f"Accession: {k.accession}\nSource URL: {k.url}"
            )
            parts.append("=" * 70)
            if k.item1_business:
                parts.append("\n## Item 1. Business (PRIMARY — base the overview on this)\n")
                parts.append(k.item1_business)
            if k.item1a_risk:
                parts.append("\n## Item 1A. Risk Factors (context only)\n")
                parts.append(k.item1a_risk)
        else:
            parts.append("[No 10-K filing available for this company.]")

        parts.append("")

        if filings.tenq:
            q = filings.tenq
            parts.append("=" * 70)
            parts.append(
                f"SECONDARY SOURCE — FORM 10-Q (latest quarterly report)\n"
                f"Filed: {q.filing_date} | Period: {q.report_date} | "
                f"Accession: {q.accession}\nSource URL: {q.url}"
            )
            parts.append("=" * 70)
            if q.mdna:
                parts.append(
                    "\n## Item 2. Management's Discussion & Analysis "
                    "(recent business/operating updates only)\n"
                )
                parts.append(q.mdna)
        else:
            parts.append("[No 10-Q filing available for this company.]")

        return "\n".join(parts)
