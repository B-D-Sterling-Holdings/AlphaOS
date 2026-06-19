"""Google Gemini API client wrapper."""

import os
from typing import Optional
import logging

from google import genai
from google.genai import types
from google.genai.types import CreateCachedContentConfig

logger = logging.getLogger(__name__)


class GeminiClient:
    """Wrapper for Google Gemini API calls."""

    SAFETY_SETTINGS = [
        types.SafetySetting(
            category=types.HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold=types.HarmBlockThreshold.BLOCK_NONE,
        ),
        types.SafetySetting(
            category=types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold=types.HarmBlockThreshold.BLOCK_NONE,
        ),
        types.SafetySetting(
            category=types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold=types.HarmBlockThreshold.BLOCK_NONE,
        ),
        types.SafetySetting(
            category=types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold=types.HarmBlockThreshold.BLOCK_NONE,
        ),
    ]

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = "gemini-2.5-flash",
        temperature: float = 0.3,
        max_output_tokens: int = 65536,
    ):
        """
        Initialize the Gemini client.

        Args:
            api_key: Gemini API key (defaults to GEMINI_API_KEY env var)
            model: Model to use (gemini-2.5-flash or gemini-2.5-pro)
            temperature: Sampling temperature (0.0 to 1.0)
            max_output_tokens: Maximum tokens in response
        """
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError(
                "Gemini API key required. Set GEMINI_API_KEY environment variable "
                "or pass api_key parameter."
            )

        self.model_name = model
        self.temperature = temperature
        self.max_output_tokens = max_output_tokens

        # Initialize the client
        self.client = genai.Client(api_key=self.api_key)

        # Track cumulative cache usage for reporting
        self.total_cached_tokens = 0
        self.total_tokens = 0

        logger.info(f"Initialized Gemini client with model: {self.model_name}")

    def generate(
        self,
        prompt: str,
        temperature: Optional[float] = None,
        max_output_tokens: Optional[int] = None,
        response_mime_type: Optional[str] = None,
    ) -> str:
        """
        Generate a response from the model.

        Args:
            prompt: The prompt to send to the model
            temperature: Override default temperature
            max_output_tokens: Override default max tokens

        Returns:
            Generated text response
        """
        config = types.GenerateContentConfig(
            temperature=temperature or self.temperature,
            max_output_tokens=max_output_tokens or self.max_output_tokens,
            safety_settings=self.SAFETY_SETTINGS,
            response_mime_type=response_mime_type,
        )

        try:
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=prompt,
                config=config,
            )

            if response.text:
                logger.debug(f"Generated {len(response.text)} characters")
                return response.text
            else:
                logger.warning("Empty response from model")
                return ""

        except Exception as e:
            logger.error(f"Error generating response: {e}")
            raise

    def generate_with_context(
        self,
        system_prompt: str,
        context: str,
        user_query: Optional[str] = None,
    ) -> str:
        """
        Generate a response with system prompt and context.

        Args:
            system_prompt: Investment philosophy / system instructions
            context: Assembled company data context
            user_query: Optional additional user query

        Returns:
            Generated text response
        """
        parts = [system_prompt, "\n\n---\n\n## Company Data for Analysis\n\n", context]

        if user_query:
            parts.append(f"\n\n---\n\n## User Query\n\n{user_query}")

        parts.append(
            "\n\n---\n\n"
            "Please analyze the above data and provide your recommendation "
            "following the output format specified in the system prompt."
        )

        full_prompt = "".join(parts)
        return self.generate(full_prompt, response_mime_type="application/json")

    def count_tokens(self, text: str) -> int:
        """
        Count tokens in text using the model's tokenizer.

        Args:
            text: Text to count tokens for

        Returns:
            Token count
        """
        try:
            result = self.client.models.count_tokens(model=self.model_name, contents=text)
            return getattr(result, "total_tokens", result)
        except Exception as e:
            logger.warning(f"Error counting tokens: {e}")
            # Fallback to rough estimate
            return len(text) // 4

    def get_model_info(self) -> dict:
        """
        Get information about the current model.

        Returns:
            Dictionary with model information
        """
        return {
            "model_name": self.model_name,
            "temperature": self.temperature,
            "max_output_tokens": self.max_output_tokens,
        }

    def test_connection(self) -> bool:
        """
        Test the API connection with a simple prompt.

        Returns:
            True if connection successful
        """
        try:
            response = self.generate("Say 'API connection successful'", max_output_tokens=50)
            return len(response) > 0
        except Exception as e:
            logger.error(f"Connection test failed: {e}")
            return False

    # ============ Context Caching Methods ============

    def create_context_cache(
        self,
        content: str,
        system_instruction: str,
        display_name: str = "analysis-cache",
        ttl_seconds: int = 3600,
    ) -> str:
        """
        Create a cached context on Gemini's servers.

        Args:
            content: The content to cache (e.g., company data context)
            system_instruction: System prompt/instructions to cache
            display_name: Human-readable name for the cache
            ttl_seconds: Time-to-live for cache in seconds (default: 1 hour)

        Returns:
            Cache resource name (use in generate_with_cache calls)
        """
        cache = self.client.caches.create(
            model=self.model_name,
            config=CreateCachedContentConfig(
                display_name=display_name,
                system_instruction=system_instruction,
                contents=[{"role": "user", "parts": [{"text": content}]}],
                ttl=f"{ttl_seconds}s",
            ),
        )
        logger.info(f"Created context cache: {cache.name} (TTL: {ttl_seconds}s)")
        return cache.name

    def generate_with_cache(
        self,
        cache_name: str,
        query: str,
    ) -> tuple[str, dict]:
        """
        Generate a response using a cached context.

        Args:
            cache_name: The cache resource name from create_context_cache
            query: The query to send (will be appended to cached context)

        Returns:
            Tuple of (response_text, usage_metadata)
        """
        config = types.GenerateContentConfig(
            cached_content=cache_name,
            temperature=self.temperature,
            max_output_tokens=self.max_output_tokens,
            safety_settings=self.SAFETY_SETTINGS,
            response_mime_type="application/json",
        )

        response = self.client.models.generate_content(
            model=self.model_name,
            contents=query,
            config=config,
        )

        # Extract usage metadata
        usage = {
            "total_tokens": getattr(response.usage_metadata, "total_token_count", 0),
            "cached_tokens": getattr(response.usage_metadata, "cached_content_token_count", 0),
            "prompt_tokens": getattr(response.usage_metadata, "prompt_token_count", 0),
            "output_tokens": getattr(response.usage_metadata, "candidates_token_count", 0),
        }

        # Update cumulative tracking
        self.total_tokens += usage["total_tokens"]
        self.total_cached_tokens += usage["cached_tokens"]

        if response.text:
            logger.debug(f"Generated {len(response.text)} characters with cached context")
            return response.text, usage
        else:
            logger.warning("Empty response from model with cached context")
            return "", usage

    def delete_cache(self, cache_name: str) -> bool:
        """
        Delete a cached context.

        Args:
            cache_name: The cache resource name to delete

        Returns:
            True if deletion successful
        """
        try:
            self.client.caches.delete(name=cache_name)
            logger.debug(f"Deleted context cache: {cache_name}")
            return True
        except Exception as e:
            logger.warning(f"Failed to delete cache {cache_name}: {e}")
            return False

    def list_caches(self) -> list:
        """
        List all active context caches.

        Returns:
            List of cache objects
        """
        return list(self.client.caches.list())

    def get_cache_savings_report(self) -> dict:
        """
        Get cumulative cache savings statistics.

        Returns:
            Dictionary with token counts and savings percentage
        """
        if self.total_tokens == 0:
            return {
                "total_tokens": 0,
                "cached_tokens": 0,
                "tokens_saved": 0,
                "savings_pct": 0.0,
            }

        # Gemini gives 90% discount on cached tokens
        tokens_saved = int(self.total_cached_tokens * 0.9)
        savings_pct = round(tokens_saved / self.total_tokens * 100, 1) if self.total_tokens > 0 else 0

        return {
            "total_tokens": self.total_tokens,
            "cached_tokens": self.total_cached_tokens,
            "tokens_saved": tokens_saved,
            "savings_pct": savings_pct,
        }
