.PHONY: install analyze clean test lint format help setup-ticker analyze-all batch list info generate-data plot

PYTHON := uv run python
TICKER ?= AAPL
OUT ?=

help:
	@echo "Available commands:"
	@echo "  make install      - Set up virtual environment and install dependencies"
	@echo "  make analyze      - Analyze a company (use TICKER=AAPL)"
	@echo "  make analyze-all  - Analyze all companies in data/ folder"
	@echo "  make list         - List available tickers"
	@echo "  make info         - Show data summary (use TICKER=AAPL)"
	@echo "  make test         - Run test suite"
	@echo "  make lint         - Run linter (ruff)"
	@echo "  make format       - Format code (ruff)"
	@echo "  make clean        - Remove cache and build artifacts"
	@echo "  make setup-ticker - Create folder structure for new ticker"
	@echo "  make generate-data - Fetch 5 years of data (requires FINNHUB_API_KEY env var)"
	@echo "  make plot         - Build interactive charts (use TICKER=AAPL, optional OUT=path)"

install:
	uv venv
	uv pip install -r requirements.txt
	@echo "Environment ready. Run 'source .venv/bin/activate' or use 'uv run'"

analyze:
	$(PYTHON) -m src.main analyze --ticker $(TICKER) $(if $(ANALYSIS_MODE),--mode $(ANALYSIS_MODE),)

analyze-all:
	$(PYTHON) -m src.main analyze --all

batch:
	$(PYTHON) -m src.main batch-report --tickers $(TICKERS) --output outputs/batch_report.json

list:
	$(PYTHON) -m src.main list

info:
	$(PYTHON) -m src.main info $(TICKER)

generate-data:
	$(PYTHON) -m src.utils.data_generator --ticker $(TICKER) --years 5

plot:
	$(PYTHON) plot_data.py --data-dir data --ticker $(TICKER) $(if $(OUT),--out $(OUT),) --open

test:
	$(PYTHON) -m pytest tests/ -v

lint:
	uv run ruff check src/ tests/

format:
	uv run ruff format src/ tests/

clean:
	rm -rf __pycache__ .pytest_cache .ruff_cache
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete

setup-ticker:
	@mkdir -p data/$(TICKER)/fundamentals
	@mkdir -p data/$(TICKER)/price_data
	@mkdir -p data/$(TICKER)/ratios
	@mkdir -p data/$(TICKER)/documents
	@echo "Created folder structure for $(TICKER)"
	@echo "  Add your CSV files to data/$(TICKER)/"
	@echo "  Add research.pdf to data/$(TICKER)/documents/"
