"""Token management for LLM context windows."""

import logging

logger = logging.getLogger(__name__)


class TokenManager:
    """Manage token budgets and estimation for LLM context."""

    # Approximate characters per token for English text
    CHARS_PER_TOKEN = 4.0

    def __init__(self, max_tokens: int = 1000000):
        """
        Initialize the token manager.

        Args:
            max_tokens: Maximum tokens allowed in context
        """
        self.max_tokens = max_tokens
        self._reserved_tokens = 0

    def estimate_tokens(self, text: str) -> int:
        """
        Estimate token count for a text string.

        This is a rough approximation. For more accurate counts,
        use the actual tokenizer for your LLM.

        Args:
            text: Text to estimate tokens for

        Returns:
            Estimated token count
        """
        if not text:
            return 0
        return int(len(text) / self.CHARS_PER_TOKEN)

    def estimate_tokens_from_chars(self, char_count: int) -> int:
        """
        Estimate token count from character count.

        Args:
            char_count: Number of characters

        Returns:
            Estimated token count
        """
        return int(char_count / self.CHARS_PER_TOKEN)

    def chars_from_tokens(self, token_count: int) -> int:
        """
        Convert token count to approximate character count.

        Args:
            token_count: Number of tokens

        Returns:
            Approximate character count
        """
        return int(token_count * self.CHARS_PER_TOKEN)

    def reserve_tokens(self, tokens: int):
        """
        Reserve tokens for system prompt or other fixed content.

        Args:
            tokens: Number of tokens to reserve
        """
        self._reserved_tokens = tokens

    def available_tokens(self) -> int:
        """
        Get available tokens after reservations.

        Returns:
            Available token count
        """
        return self.max_tokens - self._reserved_tokens

    def fits_in_context(self, text: str, additional_reserved: int = 0) -> bool:
        """
        Check if text fits in available context.

        Args:
            text: Text to check
            additional_reserved: Additional tokens to reserve

        Returns:
            True if text fits, False otherwise
        """
        tokens = self.estimate_tokens(text)
        return tokens <= (self.available_tokens() - additional_reserved)

    def truncate_to_fit(
        self, text: str, max_tokens: int | None = None, preserve_end: bool = False
    ) -> str:
        """
        Truncate text to fit within token budget.

        Args:
            text: Text to truncate
            max_tokens: Maximum tokens allowed (uses available if None)
            preserve_end: If True, truncate from beginning; otherwise from end

        Returns:
            Truncated text
        """
        if max_tokens is None:
            max_tokens = self.available_tokens()

        current_tokens = self.estimate_tokens(text)
        if current_tokens <= max_tokens:
            return text

        # Calculate target character count
        target_chars = self.chars_from_tokens(max_tokens)

        if preserve_end:
            # Truncate from beginning
            truncated = "... " + text[-target_chars:]
        else:
            # Truncate from end
            truncated = text[:target_chars] + " ..."

        logger.debug(
            f"Truncated text from {current_tokens} to ~{self.estimate_tokens(truncated)} tokens"
        )
        return truncated

    def split_by_token_budget(
        self, text: str, chunk_tokens: int
    ) -> list[str]:
        """
        Split text into chunks of approximately chunk_tokens each.

        Args:
            text: Text to split
            chunk_tokens: Target tokens per chunk

        Returns:
            List of text chunks
        """
        if not text:
            return []

        total_tokens = self.estimate_tokens(text)
        if total_tokens <= chunk_tokens:
            return [text]

        chunks = []
        target_chars = self.chars_from_tokens(chunk_tokens)

        # Split by paragraphs first
        paragraphs = text.split("\n\n")
        current_chunk = ""

        for para in paragraphs:
            if len(current_chunk) + len(para) + 2 <= target_chars:
                if current_chunk:
                    current_chunk += "\n\n"
                current_chunk += para
            else:
                if current_chunk:
                    chunks.append(current_chunk)
                if len(para) > target_chars:
                    # Split long paragraph
                    words = para.split()
                    current_chunk = ""
                    for word in words:
                        if len(current_chunk) + len(word) + 1 <= target_chars:
                            if current_chunk:
                                current_chunk += " "
                            current_chunk += word
                        else:
                            if current_chunk:
                                chunks.append(current_chunk)
                            current_chunk = word
                else:
                    current_chunk = para

        if current_chunk:
            chunks.append(current_chunk)

        return chunks

    def allocate_budget(
        self, sections: dict[str, str], priorities: list[str]
    ) -> dict[str, int]:
        """
        Allocate token budget across sections by priority.

        Args:
            sections: Dictionary of section name to content
            priorities: Ordered list of section names (highest priority first)

        Returns:
            Dictionary of section name to allocated tokens
        """
        available = self.available_tokens()
        allocations = {}

        # Calculate total tokens needed
        total_needed = sum(self.estimate_tokens(s) for s in sections.values())

        if total_needed <= available:
            # Everything fits
            for name, content in sections.items():
                allocations[name] = self.estimate_tokens(content)
            return allocations

        # Need to prioritize and potentially truncate
        remaining = available

        for section_name in priorities:
            if section_name not in sections:
                continue

            content = sections[section_name]
            needed = self.estimate_tokens(content)

            if needed <= remaining:
                allocations[section_name] = needed
                remaining -= needed
            elif remaining > 0:
                # Partial allocation
                allocations[section_name] = remaining
                remaining = 0
            else:
                allocations[section_name] = 0

        # Handle sections not in priority list
        for name in sections:
            if name not in allocations:
                allocations[name] = 0

        return allocations

    def get_usage_stats(self, text: str) -> dict:
        """
        Get token usage statistics for text.

        Args:
            text: Text to analyze

        Returns:
            Dictionary with usage statistics
        """
        tokens = self.estimate_tokens(text)
        return {
            "estimated_tokens": tokens,
            "max_tokens": self.max_tokens,
            "reserved_tokens": self._reserved_tokens,
            "available_tokens": self.available_tokens(),
            "usage_percent": (tokens / self.available_tokens() * 100) if self.available_tokens() > 0 else 0,
            "character_count": len(text),
        }
