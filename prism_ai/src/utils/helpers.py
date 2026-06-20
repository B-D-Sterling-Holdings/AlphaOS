"""General helper functions."""

import yaml
from pathlib import Path
from datetime import datetime
from typing import Any, Optional
import os


def load_yaml_config(config_path: Path | str) -> dict:
    """
    Load a YAML configuration file.

    Args:
        config_path: Path to YAML file

    Returns:
        Parsed configuration dictionary
    """
    config_path = Path(config_path)
    if not config_path.exists():
        raise FileNotFoundError(f"Config file not found: {config_path}")

    with open(config_path) as f:
        config = yaml.safe_load(f)

    # Expand environment variables
    config = _expand_env_vars(config)

    return config


def _expand_env_vars(obj: Any) -> Any:
    """
    Recursively expand environment variables in config.

    Args:
        obj: Config object (dict, list, or value)

    Returns:
        Object with environment variables expanded
    """
    if isinstance(obj, dict):
        return {k: _expand_env_vars(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_expand_env_vars(item) for item in obj]
    elif isinstance(obj, str) and obj.startswith("${") and obj.endswith("}"):
        var_name = obj[2:-1]
        return os.environ.get(var_name, obj)
    return obj


def format_currency(
    value: float,
    currency: str = "$",
    decimal_places: int = 2,
    abbreviate: bool = True,
) -> str:
    """
    Format a number as currency.

    Args:
        value: Numeric value
        currency: Currency symbol
        decimal_places: Number of decimal places
        abbreviate: Whether to abbreviate large numbers (M, B, T)

    Returns:
        Formatted currency string
    """
    if value is None:
        return "N/A"

    if abbreviate and abs(value) >= 1e12:
        return f"{currency}{value/1e12:.{decimal_places}f}T"
    elif abbreviate and abs(value) >= 1e9:
        return f"{currency}{value/1e9:.{decimal_places}f}B"
    elif abbreviate and abs(value) >= 1e6:
        return f"{currency}{value/1e6:.{decimal_places}f}M"
    else:
        return f"{currency}{value:,.{decimal_places}f}"


def format_percentage(
    value: float,
    decimal_places: int = 2,
    include_sign: bool = False,
) -> str:
    """
    Format a number as percentage.

    Args:
        value: Numeric value (e.g., 0.15 for 15%)
        decimal_places: Number of decimal places
        include_sign: Whether to include + sign for positive values

    Returns:
        Formatted percentage string
    """
    if value is None:
        return "N/A"

    # Check if value is already in percentage form
    if abs(value) > 1 and abs(value) < 100:
        # Likely already a percentage
        pct = value
    else:
        # Convert from decimal
        pct = value * 100

    if include_sign and pct > 0:
        return f"+{pct:.{decimal_places}f}%"
    return f"{pct:.{decimal_places}f}%"


def safe_divide(
    numerator: Optional[float],
    denominator: Optional[float],
    default: float = 0.0,
) -> float:
    """
    Safely divide two numbers.

    Args:
        numerator: Number to divide
        denominator: Number to divide by
        default: Value to return if division is not possible

    Returns:
        Result of division or default
    """
    if numerator is None or denominator is None:
        return default
    if denominator == 0:
        return default
    return numerator / denominator


def date_to_str(
    date: datetime,
    fmt: str = "%Y-%m-%d",
) -> str:
    """
    Convert datetime to string.

    Args:
        date: Datetime object
        fmt: Date format string

    Returns:
        Formatted date string
    """
    if date is None:
        return "N/A"
    return date.strftime(fmt)


def str_to_date(
    date_str: str,
    fmt: str = "%Y-%m-%d",
) -> Optional[datetime]:
    """
    Convert string to datetime.

    Args:
        date_str: Date string
        fmt: Expected date format

    Returns:
        Datetime object or None if parsing fails
    """
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, fmt)
    except ValueError:
        return None


def flatten_dict(
    d: dict,
    parent_key: str = "",
    sep: str = ".",
) -> dict:
    """
    Flatten a nested dictionary.

    Args:
        d: Dictionary to flatten
        parent_key: Parent key prefix
        sep: Separator between keys

    Returns:
        Flattened dictionary
    """
    items = []
    for k, v in d.items():
        new_key = f"{parent_key}{sep}{k}" if parent_key else k
        if isinstance(v, dict):
            items.extend(flatten_dict(v, new_key, sep=sep).items())
        else:
            items.append((new_key, v))
    return dict(items)


def ensure_dir(path: Path | str) -> Path:
    """
    Ensure a directory exists, creating if necessary.

    Args:
        path: Directory path

    Returns:
        Path object
    """
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    return path


def clean_ticker(ticker: str) -> str:
    """
    Clean and normalize a ticker symbol.

    Args:
        ticker: Ticker symbol

    Returns:
        Cleaned ticker (uppercase, trimmed)
    """
    return ticker.strip().upper()


def chunk_list(lst: list, chunk_size: int) -> list[list]:
    """
    Split a list into chunks.

    Args:
        lst: List to split
        chunk_size: Maximum size of each chunk

    Returns:
        List of chunks
    """
    return [lst[i:i + chunk_size] for i in range(0, len(lst), chunk_size)]
