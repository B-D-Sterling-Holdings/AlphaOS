"""Load and manage prompt configurations."""

from pathlib import Path
from typing import Optional
import logging

logger = logging.getLogger(__name__)


class PromptLoader:
    """Load prompt configurations from markdown files."""

    def __init__(self, prompts_dir: Optional[Path | str] = None):
        """
        Initialize the prompt loader.

        Args:
            prompts_dir: Directory containing prompt files
        """
        if prompts_dir is None:
            prompts_dir = Path(__file__).parent.parent.parent / "config" / "prompts"
        self.prompts_dir = Path(prompts_dir)
        self._cache: dict[str, str] = {}

    def load_prompt(self, prompt_name: str) -> str:
        """
        Load a prompt by name.

        Args:
            prompt_name: Name of the prompt file (without .md extension)

        Returns:
            Prompt content
        """
        if prompt_name in self._cache:
            return self._cache[prompt_name]

        # Try direct path first
        prompt_path = self.prompts_dir / f"{prompt_name}.md"
        if not prompt_path.exists():
            # Try without extension (in case full filename provided)
            prompt_path = self.prompts_dir / prompt_name
            if not prompt_path.exists():
                raise FileNotFoundError(f"Prompt not found: {prompt_name}")

        content = prompt_path.read_text()
        self._cache[prompt_name] = content
        logger.debug(f"Loaded prompt: {prompt_name} ({len(content)} chars)")
        return content

    def load_investment_philosophy(self) -> str:
        """Load the main investment philosophy prompt."""
        return self.load_prompt("investment_philosophy")

    def load_risk_assessment(self) -> str:
        """Load the risk assessment prompt."""
        return self.load_prompt("risk_assessment")

    def load_position_sizing(self) -> str:
        """Load the position sizing prompt."""
        return self.load_prompt("position_sizing")

    def load_thesis_critique(self) -> str:
        """Load the thesis-critique addendum (used in critique mode)."""
        return self.load_prompt("thesis_critique")

    def load_sector_prompt(self, sector: str) -> Optional[str]:
        """
        Load a sector-specific prompt.

        Args:
            sector: Sector name (technology, healthcare, financials, etc.)

        Returns:
            Sector prompt content or None if not found
        """
        sector_path = self.prompts_dir / "sector_specific" / f"{sector.lower()}.md"
        if sector_path.exists():
            content = sector_path.read_text()
            logger.debug(f"Loaded sector prompt: {sector}")
            return content
        logger.warning(f"No sector-specific prompt found for: {sector}")
        return None

    def load_combined_prompt(
        self,
        include_risk: bool = False,
        include_sizing: bool = True,
        sector: Optional[str] = None,
        mode: str = "balanced",
    ) -> str:
        """
        Load and combine the system prompt components.

        The pipeline runs a single investment philosophy (DHQ). The `mode` and
        `sector` arguments are retained for call-site compatibility but no longer
        select alternate prompts — every analysis uses investment_philosophy
        (+ position_sizing). Risk guidance is integrated into the philosophy.

        Args:
            include_risk: Deprecated; risk framework now lives in the philosophy.
            include_sizing: Include position sizing rules.
            sector: Ignored (sector-specific prompts removed).
            mode: Ignored (single philosophy); kept for signature compatibility.

        Returns:
            Combined prompt string
        """
        sections = [self.load_investment_philosophy()]

        if include_sizing:
            try:
                sizing_prompt = self.load_position_sizing()
                sections.append("\n\n---\n\n" + sizing_prompt)
            except FileNotFoundError:
                logger.warning("Position sizing prompt not found")

        return "".join(sections)

    def load_custom_prompt(self, prompt_path: Path | str) -> str:
        """
        Load a custom prompt from any path.

        Args:
            prompt_path: Full path to prompt file

        Returns:
            Prompt content
        """
        path = Path(prompt_path)
        if not path.exists():
            raise FileNotFoundError(f"Custom prompt not found: {prompt_path}")
        return path.read_text()

    def list_available_prompts(self) -> dict[str, list[str]]:
        """
        List all available prompts.

        Returns:
            Dictionary with main prompts and sector prompts
        """
        result = {"main": [], "sectors": []}

        # Main prompts
        for f in self.prompts_dir.glob("*.md"):
            result["main"].append(f.stem)

        # Sector prompts
        sector_dir = self.prompts_dir / "sector_specific"
        if sector_dir.exists():
            for f in sector_dir.glob("*.md"):
                result["sectors"].append(f.stem)

        return result

    def get_prompt_info(self, prompt_name: str) -> dict:
        """
        Get metadata about a prompt.

        Args:
            prompt_name: Name of the prompt

        Returns:
            Dictionary with prompt metadata
        """
        content = self.load_prompt(prompt_name)
        lines = content.split("\n")

        # Extract title from first heading
        title = prompt_name
        for line in lines:
            if line.startswith("# "):
                title = line[2:].strip()
                break

        # Count sections
        sections = [l for l in lines if l.startswith("## ")]

        return {
            "name": prompt_name,
            "title": title,
            "character_count": len(content),
            "line_count": len(lines),
            "section_count": len(sections),
            "sections": [s[3:].strip() for s in sections],
        }

    def clear_cache(self):
        """Clear the prompt cache."""
        self._cache.clear()
        logger.debug("Prompt cache cleared")
