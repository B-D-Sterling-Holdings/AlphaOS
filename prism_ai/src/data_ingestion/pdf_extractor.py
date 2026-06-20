"""PDF text extraction for research documents."""

import base64
import logging
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF

from ..utils.supabase_store import SupabaseStore

logger = logging.getLogger(__name__)


class PDFExtractor:
    """Extract text content from PDF documents."""

    def __init__(self, chunk_size: int = 2000, store: Optional[SupabaseStore] = None):
        """
        Initialize the PDF extractor.

        Args:
            chunk_size: Approximate number of characters per chunk
            store: SupabaseStore for reading documents (defaults to one from env)
        """
        self.chunk_size = chunk_size
        self.store = store or SupabaseStore()

    def extract_from_bytes(self, data: bytes, name: str = "document.pdf") -> str:
        """Extract all text from raw PDF bytes (Supabase-sourced documents)."""
        try:
            doc = fitz.open(stream=data, filetype="pdf")
            text_parts = []
            for page_num, page in enumerate(doc):
                text = page.get_text()
                if text.strip():
                    text_parts.append(f"[Page {page_num + 1}]\n{text}")
            doc.close()
            full_text = "\n\n".join(text_parts)
            logger.info(f"Extracted {len(full_text)} characters from {name}")
            return full_text
        except Exception as e:
            logger.error(f"Error extracting text from {name}: {e}")
            raise

    def extract_text(self, pdf_path: Path | str) -> str:
        """
        Extract all text from a PDF file.

        Args:
            pdf_path: Path to PDF file

        Returns:
            Extracted text content
        """
        pdf_path = Path(pdf_path)
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")

        try:
            doc = fitz.open(pdf_path)
            text_parts = []

            for page_num, page in enumerate(doc):
                text = page.get_text()
                if text.strip():
                    text_parts.append(f"[Page {page_num + 1}]\n{text}")

            doc.close()

            full_text = "\n\n".join(text_parts)
            logger.info(f"Extracted {len(full_text)} characters from {pdf_path.name}")
            return full_text

        except Exception as e:
            logger.error(f"Error extracting text from {pdf_path}: {e}")
            raise

    def extract_text_chunked(self, pdf_path: Path | str) -> list[str]:
        """
        Extract text from PDF in chunks suitable for LLM context.

        Args:
            pdf_path: Path to PDF file

        Returns:
            List of text chunks
        """
        full_text = self.extract_text(pdf_path)
        return self._chunk_text(full_text)

    def _chunk_text(self, text: str) -> list[str]:
        """
        Split text into chunks of approximately chunk_size characters.

        Args:
            text: Full text to chunk

        Returns:
            List of text chunks
        """
        if len(text) <= self.chunk_size:
            return [text]

        chunks = []
        current_chunk = ""

        # Split by paragraphs (double newline)
        paragraphs = text.split("\n\n")

        for para in paragraphs:
            if len(current_chunk) + len(para) + 2 <= self.chunk_size:
                if current_chunk:
                    current_chunk += "\n\n"
                current_chunk += para
            else:
                if current_chunk:
                    chunks.append(current_chunk)
                # If paragraph itself is too long, split by sentences
                if len(para) > self.chunk_size:
                    sentences = self._split_into_sentences(para)
                    current_chunk = ""
                    for sentence in sentences:
                        if len(current_chunk) + len(sentence) + 1 <= self.chunk_size:
                            if current_chunk:
                                current_chunk += " "
                            current_chunk += sentence
                        else:
                            if current_chunk:
                                chunks.append(current_chunk)
                            current_chunk = sentence
                else:
                    current_chunk = para

        if current_chunk:
            chunks.append(current_chunk)

        logger.debug(f"Split text into {len(chunks)} chunks")
        return chunks

    def _split_into_sentences(self, text: str) -> list[str]:
        """
        Split text into sentences.

        Args:
            text: Text to split

        Returns:
            List of sentences
        """
        import re

        # Simple sentence splitting on common terminators
        sentences = re.split(r"(?<=[.!?])\s+", text)
        return [s.strip() for s in sentences if s.strip()]

    def extract_from_company(
        self, data_dir: Path | str, ticker: str
    ) -> Optional[str]:
        """
        Extract text from company's research PDF.

        Args:
            data_dir: Root data directory
            ticker: Company ticker symbol

        Returns:
            Extracted text or None if no PDF found
        """
        # 1) Supabase documents
        if self.store.is_configured():
            try:
                docs = self.store.get_documents(ticker)
            except Exception as e:
                logger.warning(f"Supabase document read failed for {ticker}: {e}")
                docs = []
            if docs:
                # Prefer research.pdf, else the first document.
                chosen = next((d for d in docs if d.get("filename") == "research.pdf"), docs[0])
                logger.info(f"Using {chosen.get('filename')} for {ticker} (Supabase)")
                return self.extract_from_bytes(
                    base64.b64decode(chosen["content_base64"]), chosen.get("filename", "document.pdf")
                )

        # 2) Local-disk fallback
        data_dir = Path(data_dir)
        docs_dir = data_dir / ticker / "documents"
        if not docs_dir.exists():
            logger.warning(f"No documents for {ticker}")
            return None

        research_pdf = docs_dir / "research.pdf"
        if research_pdf.exists():
            return self.extract_text(research_pdf)

        pdf_files = list(docs_dir.glob("*.pdf"))
        if pdf_files:
            logger.info(f"Using {pdf_files[0].name} for {ticker} (local)")
            return self.extract_text(pdf_files[0])

        logger.warning(f"No PDF documents found for {ticker}")
        return None

    def get_pdf_metadata(self, pdf_path: Path | str) -> dict:
        """
        Get metadata from a PDF file.

        Args:
            pdf_path: Path to PDF file

        Returns:
            Dictionary of metadata
        """
        pdf_path = Path(pdf_path)
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")

        try:
            doc = fitz.open(pdf_path)
            metadata = {
                "title": doc.metadata.get("title", ""),
                "author": doc.metadata.get("author", ""),
                "subject": doc.metadata.get("subject", ""),
                "creator": doc.metadata.get("creator", ""),
                "producer": doc.metadata.get("producer", ""),
                "creation_date": doc.metadata.get("creationDate", ""),
                "modification_date": doc.metadata.get("modDate", ""),
                "page_count": len(doc),
            }
            doc.close()
            return metadata

        except Exception as e:
            logger.error(f"Error getting metadata from {pdf_path}: {e}")
            raise
