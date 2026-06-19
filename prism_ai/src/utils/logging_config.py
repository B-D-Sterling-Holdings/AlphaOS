"""Logging configuration for the application."""

import logging
import sys
from pathlib import Path
from datetime import datetime
from typing import Optional


def setup_logging(
    level: str = "INFO",
    log_file: Optional[Path | str] = None,
    log_dir: Optional[Path | str] = None,
) -> logging.Logger:
    """
    Set up logging configuration.

    Args:
        level: Logging level (DEBUG, INFO, WARNING, ERROR)
        log_file: Specific log file path
        log_dir: Directory for log files (auto-generates filename)

    Returns:
        Root logger
    """
    # Convert level string to logging constant
    numeric_level = getattr(logging, level.upper(), logging.INFO)

    # Create formatter
    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(numeric_level)

    # Clear existing handlers
    root_logger.handlers.clear()

    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(numeric_level)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    # File handler (if requested)
    if log_file or log_dir:
        if log_file:
            log_path = Path(log_file)
        else:
            log_dir = Path(log_dir)
            log_dir.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            log_path = log_dir / f"llm_quant_{timestamp}.log"

        log_path.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(log_path)
        file_handler.setLevel(numeric_level)
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)

        root_logger.info(f"Logging to file: {log_path}")

    return root_logger


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger with the specified name.

    Args:
        name: Logger name (usually __name__)

    Returns:
        Logger instance
    """
    return logging.getLogger(name)


class LogContext:
    """Context manager for temporary log level changes."""

    def __init__(self, logger: logging.Logger, level: int):
        """
        Initialize log context.

        Args:
            logger: Logger to modify
            level: Temporary logging level
        """
        self.logger = logger
        self.new_level = level
        self.old_level = None

    def __enter__(self):
        self.old_level = self.logger.level
        self.logger.setLevel(self.new_level)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.logger.setLevel(self.old_level)
        return False


def silence_logger(name: str):
    """
    Silence a specific logger.

    Args:
        name: Logger name to silence
    """
    logging.getLogger(name).setLevel(logging.WARNING)


def verbose_logger(name: str):
    """
    Make a specific logger verbose (DEBUG level).

    Args:
        name: Logger name to make verbose
    """
    logging.getLogger(name).setLevel(logging.DEBUG)
