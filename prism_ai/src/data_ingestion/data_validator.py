"""Data validation against configured schemas."""

import pandas as pd
import yaml
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, field
import logging

logger = logging.getLogger(__name__)


@dataclass
class ValidationResult:
    """Result of data validation."""

    is_valid: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    summary: dict = field(default_factory=dict)


class DataValidator:
    """Validate financial data against configured schemas."""

    def __init__(self, schema_path: Optional[Path | str] = None):
        """
        Initialize the validator.

        Args:
            schema_path: Path to data_schema.yaml file
        """
        if schema_path is None:
            # Default to config directory relative to this file
            schema_path = Path(__file__).parent.parent.parent / "config" / "data_schema.yaml"

        self.schema_path = Path(schema_path)
        self._schemas = None
        self._validation_settings = None

    @property
    def schemas(self) -> dict:
        """Load and cache schemas."""
        if self._schemas is None:
            self._load_schemas()
        return self._schemas

    @property
    def validation_settings(self) -> dict:
        """Load and cache validation settings."""
        if self._validation_settings is None:
            self._load_schemas()
        return self._validation_settings

    def _load_schemas(self):
        """Load schema configuration from YAML."""
        if not self.schema_path.exists():
            logger.warning(f"Schema file not found: {self.schema_path}")
            self._schemas = {}
            self._validation_settings = {}
            return

        with open(self.schema_path) as f:
            config = yaml.safe_load(f)

        self._schemas = config.get("schemas", {})
        self._validation_settings = config.get("validation", {})
        logger.debug(f"Loaded {len(self._schemas)} schemas from {self.schema_path}")

    def validate_dataframe(
        self, df: pd.DataFrame, schema_name: str
    ) -> ValidationResult:
        """
        Validate a DataFrame against a named schema.

        Args:
            df: DataFrame to validate
            schema_name: Name of schema to validate against

        Returns:
            ValidationResult with validation status and details
        """
        if schema_name not in self.schemas:
            return ValidationResult(
                is_valid=False,
                errors=[f"Unknown schema: {schema_name}"],
            )

        schema = self.schemas[schema_name]
        errors = []
        warnings = []

        # Check required columns
        required = schema.get("required_columns", [])
        missing_required = [col for col in required if col not in df.columns]
        if missing_required:
            errors.append(f"Missing required columns: {missing_required}")

        # Check for optional columns present
        optional = schema.get("optional_columns", [])
        present_optional = [col for col in optional if col in df.columns]

        # Validate column types
        column_types = schema.get("column_types", {})
        for col, expected_type in column_types.items():
            if col in df.columns:
                type_error = self._validate_column_type(df[col], expected_type, col)
                if type_error:
                    warnings.append(type_error)

        # Check for NaN values
        max_nan_pct = self.validation_settings.get("max_nan_percentage", 0.3)
        for col in df.columns:
            nan_pct = df[col].isna().mean()
            if nan_pct > max_nan_pct:
                warnings.append(
                    f"Column '{col}' has {nan_pct:.1%} NaN values (threshold: {max_nan_pct:.1%})"
                )

        # Check date ordering if applicable
        if "date" in df.columns and not df["date"].isna().all():
            if not df["date"].is_monotonic_increasing:
                warnings.append("Dates are not in ascending order")

        summary = {
            "rows": len(df),
            "columns": len(df.columns),
            "required_present": len(required) - len(missing_required),
            "required_total": len(required),
            "optional_present": len(present_optional),
            "optional_total": len(optional),
        }

        is_valid = len(errors) == 0
        return ValidationResult(
            is_valid=is_valid,
            errors=errors,
            warnings=warnings,
            summary=summary,
        )

    def _validate_column_type(
        self, series: pd.Series, expected_type: str, col_name: str
    ) -> Optional[str]:
        """
        Validate that a series matches expected type.

        Args:
            series: Pandas series to validate
            expected_type: Expected type string (date, float, int)
            col_name: Column name for error messages

        Returns:
            Error message if validation fails, None otherwise
        """
        if expected_type == "date":
            if not pd.api.types.is_datetime64_any_dtype(series):
                return f"Column '{col_name}' should be datetime type"

        elif expected_type == "float":
            if not pd.api.types.is_numeric_dtype(series):
                return f"Column '{col_name}' should be numeric type"

        elif expected_type == "int":
            if not pd.api.types.is_numeric_dtype(series):
                return f"Column '{col_name}' should be integer type"

        elif expected_type == "quarter":
            # Accept 1-4 or Q1-Q4 (case-insensitive)
            if pd.api.types.is_numeric_dtype(series):
                valid = series.dropna().isin([1, 2, 3, 4]).all()
                if not valid:
                    return f"Column '{col_name}' should be quarter values 1-4"
            else:
                normalized = series.dropna().astype(str).str.strip().str.upper()
                valid = normalized.isin(["Q1", "Q2", "Q3", "Q4"]).all()
                if not valid:
                    return f"Column '{col_name}' should be quarter values Q1-Q4"

        return None

    def validate_company_data(
        self, data: dict[str, pd.DataFrame]
    ) -> dict[str, ValidationResult]:
        """
        Validate all data files for a company.

        Args:
            data: Dictionary mapping file keys to DataFrames

        Returns:
            Dictionary mapping file keys to ValidationResults
        """
        results = {}

        for key, df in data.items():
            # Extract schema name from key (e.g., "fundamentals/income_statement" -> "income_statement")
            schema_name = key.split("/")[-1]

            if schema_name in self.schemas:
                results[key] = self.validate_dataframe(df, schema_name)
            else:
                # No schema defined, do basic validation
                results[key] = self._basic_validation(df, key)

        return results

    def _basic_validation(self, df: pd.DataFrame, name: str) -> ValidationResult:
        """
        Perform basic validation when no schema is defined.

        Args:
            df: DataFrame to validate
            name: Name for error messages

        Returns:
            ValidationResult
        """
        warnings = []

        if df.empty:
            return ValidationResult(
                is_valid=False,
                errors=[f"DataFrame '{name}' is empty"],
            )

        # Check for excessive NaN values
        max_nan_pct = self.validation_settings.get("max_nan_percentage", 0.3)
        for col in df.columns:
            nan_pct = df[col].isna().mean()
            if nan_pct > max_nan_pct:
                warnings.append(
                    f"Column '{col}' has {nan_pct:.1%} NaN values"
                )

        return ValidationResult(
            is_valid=True,
            warnings=warnings,
            summary={
                "rows": len(df),
                "columns": len(df.columns),
            },
        )

    def get_schema_info(self, schema_name: str) -> Optional[dict]:
        """
        Get information about a specific schema.

        Args:
            schema_name: Name of the schema

        Returns:
            Schema configuration or None if not found
        """
        return self.schemas.get(schema_name)

    def list_schemas(self) -> list[str]:
        """
        List all available schema names.

        Returns:
            List of schema names
        """
        return list(self.schemas.keys())
