"""Main entry point for LLM Quant analysis."""

import argparse
import json
import os
import sys
from pathlib import Path
from datetime import datetime

from dotenv import load_dotenv

from .llm_engine import InferenceEngine
from .utils import setup_logging, load_yaml_config


def get_default_paths() -> tuple[Path, Path, Path]:
    """Get default paths relative to this file."""
    src_dir = Path(__file__).parent
    project_dir = src_dir.parent
    data_dir = project_dir / "data"
    config_dir = project_dir / "config"
    output_dir = project_dir / "outputs"
    return data_dir, config_dir, output_dir


def analyze_command(args):
    """Run analysis on one or more companies."""
    data_dir, config_dir, output_dir = get_default_paths()

    # Override with args if provided
    if args.data_dir:
        data_dir = Path(args.data_dir)
    if args.config_dir:
        config_dir = Path(args.config_dir)
    if args.output_dir:
        output_dir = Path(args.output_dir)

    # Set up logging
    log_level = "DEBUG" if args.verbose else "INFO"
    setup_logging(level=log_level, log_dir=output_dir / "logs")

    # Initialize engine
    engine = InferenceEngine(
        data_dir=data_dir,
        config_dir=config_dir,
        model=args.model,
    )

    # Test API connection
    if not engine.test_api():
        print("Failed to connect to Ollama. Is it running? Check OLLAMA_BASE_URL.")
        sys.exit(1)

    # Run analysis
    if args.all:
        print("Analyzing all companies...")
        results = engine.analyze_all(
            prompt_name=args.prompt,
            save_output=not args.no_save,
        )
        print(f"\nCompleted analysis of {len(results)} companies:")
        for ticker, result in results.items():
            print(f"  {ticker}: {result.recommendation.signal} ({result.recommendation.conviction})")
    else:
        ticker = args.ticker.upper()
        mode = getattr(args, 'mode', 'balanced')
        print(f"Analyzing {ticker} (mode: {mode})...")
        result = engine.analyze(
            ticker=ticker,
            prompt_name=args.prompt,
            sector=args.sector,
            mode=mode,
            save_output=not args.no_save,
            output_dir=output_dir / "recommendations",
        )

        # Print summary
        print(f"\n{'='*60}")
        print(f"Analysis Results for {ticker}")
        print(f"{'='*60}")
        print(f"Signal: {result.recommendation.signal}")
        print(f"Conviction: {result.recommendation.conviction}")
        print(f"Position Size: {result.recommendation.position_size_pct}%")

        if result.recommendation.price_target_12mo:
            print(f"Price Target (12mo): ${result.recommendation.price_target_12mo}")
        if result.recommendation.stop_loss_price:
            print(f"Stop Loss: ${result.recommendation.stop_loss_price}")

        if result.recommendation.key_catalysts:
            print(f"\nKey Catalysts:")
            for catalyst in result.recommendation.key_catalysts:
                print(f"  - {catalyst}")

        if result.recommendation.key_risks:
            print(f"\nKey Risks:")
            for risk in result.recommendation.key_risks:
                print(f"  - {risk}")

        if result.executive_summary:
            print(f"\nExecutive Summary:")
            print(f"  {result.executive_summary[:500]}...")

        print(f"{'='*60}")


def batch_command(args):
    """Generate batch report for multiple tickers."""
    data_dir, config_dir, output_dir = get_default_paths()

    setup_logging(level="INFO", log_dir=output_dir / "logs")

    engine = InferenceEngine(
        data_dir=data_dir,
        config_dir=config_dir,
        model=args.model,
    )

    # Parse tickers
    tickers = [t.strip().upper() for t in args.tickers.split(",")]
    print(f"Running batch analysis for {len(tickers)} tickers...")

    results = engine.analyze_batch(tickers)

    # Create batch report
    report = {
        "generated_at": datetime.now().isoformat(),
        "model": args.model,
        "ticker_count": len(tickers),
        "results": {},
    }

    for ticker, result in results.items():
        report["results"][ticker] = {
            "signal": result.recommendation.signal,
            "conviction": result.recommendation.conviction,
            "position_size_pct": result.recommendation.position_size_pct,
            "key_catalysts": result.recommendation.key_catalysts,
            "key_risks": result.recommendation.key_risks,
        }

    # Save report
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"Batch report saved to: {output_path}")

    # Print summary
    print(f"\nBatch Summary:")
    for ticker, result in results.items():
        print(f"  {ticker}: {result.recommendation.signal}")


def list_command(args):
    """List available tickers."""
    data_dir, _, _ = get_default_paths()
    if args.data_dir:
        data_dir = Path(args.data_dir)

    from .data_ingestion import CSVParser

    parser = CSVParser(data_dir)
    tickers = parser.get_available_tickers()

    if not tickers:
        print(f"No data found in {data_dir}")
        return

    print(f"Available tickers ({len(tickers)}):")
    for ticker in tickers:
        summary = parser.get_data_summary(ticker)
        file_count = len(summary.get("files", {}))
        print(f"  {ticker}: {file_count} data files")


def info_command(args):
    """Show information about a ticker's data."""
    data_dir, _, _ = get_default_paths()
    if args.data_dir:
        data_dir = Path(args.data_dir)

    from .data_ingestion import CSVParser

    parser = CSVParser(data_dir)
    ticker = args.ticker.upper()
    summary = parser.get_data_summary(ticker)

    if "error" in summary:
        print(summary["error"])
        return

    print(f"\nData Summary for {ticker}")
    print("=" * 50)

    print("\nFiles:")
    for key, info in summary.get("files", {}).items():
        date_info = summary.get("date_ranges", {}).get(key, {})
        date_range = ""
        if date_info.get("min") and date_info.get("max"):
            date_range = f" [{date_info['min']} to {date_info['max']}]"
        print(f"  {key}: {info['rows']} rows{date_range}")


def main():
    """Main entry point."""
    # Load environment variables
    load_dotenv()

    parser = argparse.ArgumentParser(
        description="LLM Quant: AI-Powered Fundamental Analysis",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # Analyze command
    analyze_parser = subparsers.add_parser("analyze", help="Analyze a company")
    analyze_parser.add_argument("--ticker", "-t", help="Ticker symbol to analyze")
    analyze_parser.add_argument("--all", "-a", action="store_true", help="Analyze all tickers")
    analyze_parser.add_argument("--sector", "-s", help="Sector for sector-specific analysis")
    analyze_parser.add_argument("--prompt", "-p", help="Custom prompt file path")
    analyze_parser.add_argument("--mode", choices=["balanced"],
                               default="balanced", help="Analysis mode (single DHQ investment philosophy)")
    analyze_parser.add_argument("--model", "-m",
                               default=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
                               help="Gemini model to use (or set GEMINI_MODEL)")
    analyze_parser.add_argument("--data-dir", help="Data directory path")
    analyze_parser.add_argument("--config-dir", help="Config directory path")
    analyze_parser.add_argument("--output-dir", help="Output directory path")
    analyze_parser.add_argument("--no-save", action="store_true", help="Don't save output files")
    analyze_parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    analyze_parser.set_defaults(func=analyze_command)

    # Batch command
    batch_parser = subparsers.add_parser("batch-report", help="Generate batch report")
    batch_parser.add_argument("--tickers", required=True, help="Comma-separated list of tickers")
    batch_parser.add_argument("--output", "-o", required=True, help="Output file path")
    batch_parser.add_argument("--model", "-m",
                             default=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"))
    batch_parser.set_defaults(func=batch_command)

    # List command
    list_parser = subparsers.add_parser("list", help="List available tickers")
    list_parser.add_argument("--data-dir", help="Data directory path")
    list_parser.set_defaults(func=list_command)

    # Info command
    info_parser = subparsers.add_parser("info", help="Show ticker data info")
    info_parser.add_argument("ticker", help="Ticker symbol")
    info_parser.add_argument("--data-dir", help="Data directory path")
    info_parser.set_defaults(func=info_command)

    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        sys.exit(1)

    # Validate analyze command
    if args.command == "analyze" and not args.all and not args.ticker:
        print("Error: Either --ticker or --all is required")
        sys.exit(1)

    # Run the command
    args.func(args)


if __name__ == "__main__":
    main()
