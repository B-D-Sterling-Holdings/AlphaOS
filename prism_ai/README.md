# LLM Quant (llm_model)

This directory contains an end-to-end pipeline for LLM-driven fundamental analysis.
It ingests your CSV + PDF research data, builds a structured context, prompts Gemini,
and parses the response into structured recommendations.

## Pipeline overview (what happens when you run analysis)

1) Data ingestion
   - CSVs are loaded from `data/<TICKER>/fundamentals`, `data/<TICKER>/price_data`,
     and `data/<TICKER>/ratios`.
   - A research PDF is loaded from `data/<TICKER>/documents/research.pdf`
     (or the first `.pdf` file in that folder).
   - CSV parsing rules:
     - If a `date` column exists, it is parsed and sorted ascending.
     - Non-date columns are coerced to numeric where possible.

2) Context assembly
   - The pipeline ranks data by category and recency, then formats each section
     into markdown tables.
   - By default, it focuses on the most recent ~5 years of data per file.
   - PDF text is appended as a separate section (truncated if too long).

3) Prompt construction
   - The prompt is a concatenation of:
     - `config/prompts/investment_philosophy.md`
     - `config/prompts/position_sizing.md`
   - Optional sector prompt from `config/prompts/sector_specific/<sector>.md`

4) LLM inference
   - Gemini is called with the system prompt + assembled company context.
   - Default model: `gemini-2.5-flash`.

5) Response parsing and output
   - The response is parsed for a JSON recommendation block and known sections.
   - Output is saved to `outputs/recommendations/` as both `.json` and `.md`.

## Requirements

- Python >= 3.10
- `uv` (used by the `Makefile` to run Python and manage the venv)
- A Gemini API key in `GEMINI_API_KEY` (for analysis)
- An Alpha Vantage API key in `ALPHA_VANTAGE_API_KEY` (for data generation)
- Dependencies in `requirements.txt`
- Plotting requires `plotly` (included in requirements)

## Install (Makefile only)

```bash
cd llm_model
make install
```

This uses the `Makefile` install target (which runs `uv venv` and installs
dependencies).

## Environment setup

The CLI loads environment variables from `.env` in the `llm_model` directory.
Ensure `llm_model/.env` contains at least:

- `GEMINI_API_KEY` (required for analysis)
- `ALPHA_VANTAGE_API_KEY` (required for data generation)

## Data layout (required)

Create one folder per ticker in `llm_model/data/`, using this structure:

```
data/
  AAPL/
    fundamentals/
      revenue.csv
      operating_margins.csv
      buybacks.csv
      eps.csv
      fcf.csv
    price_data/
      daily_prices.csv
    ratios/
      valuation_ratios.csv
    documents/
      research.pdf
```

### CSV schema (recommended)

The CLI does not enforce schemas by default, but these files/columns are expected
by the prompt and priority ranking logic. If you follow these, results are best.

Fundamentals (only these files are used):
- `fundamentals/revenue.csv`
  - required: `year`, `quarter`, `revenue`
  - common optional: `revenue_growth_yoy`, `revenue_growth_qoq`
- `fundamentals/operating_margins.csv`
  - required: `year`, `quarter`, `operating_margin`
  - common optional: `gross_margin`, `net_margin`
- `fundamentals/buybacks.csv`
  - required: `year`, `quarter`, `shares_outstanding`
  - common optional: `shares_repurchased`, `buyback_amount`
- `fundamentals/eps.csv`
  - required: `year`, `quarter`, `eps_diluted`
  - common optional: `eps_basic`, `eps_growth_yoy`, `eps_growth_qoq`
- `fundamentals/fcf.csv`
  - required: `year`, `quarter`, `free_cash_flow`
  - common optional: `operating_cash_flow`, `capital_expenditures`, `fcf_margin`

Ratios:
- `ratios/valuation_ratios.csv`
  - required: `date`, `pe_ratio`, `fcf_yield`
  - optional: `price`

Price data (only this file is used):
- `price_data/daily_prices.csv`
  - required: `date`, `close`

Quarter values should be `Q1`, `Q2`, `Q3`, or `Q4`. The loader derives a
calendar `date` internally for ordering and recency checks.

If you want strict validation against `config/data_schema.yaml`, use the
`DataValidator` class directly (not called by the CLI today).

## Running the pipeline (Makefile only)

### 1) Set up or generate data

Create the folder structure for a new ticker:

```bash
cd llm_model
make setup-ticker TICKER=AAPL
```

Generate 5 years (20 quarters) of fundamentals from Alpha Vantage and price data from yfinance:

```bash
make generate-data TICKER=NFLX
```

### 2) Inspect available data

List tickers that have data:

```bash
make list
```

Show a summary for a ticker (row counts + date ranges):

```bash
make info TICKER=AAPL
```

### 3) (Optional) Plot charts

Creates an interactive Plotly dashboard (opens automatically):

```bash
make plot TICKER=AAPL
```

Optional output path:

```bash
make plot TICKER=AAPL OUT=/tmp/aapl_charts.html
```

The plotter reads:
- `data/<TICKER>/fundamentals/*.csv`
- `data/<TICKER>/price_data/daily_prices.csv` (uses only `date` and `close`)
- `data/<TICKER>/ratios/valuation_ratios.csv`

### 4) Run analysis

Analyze a single ticker:

```bash
make analyze TICKER=AAPL
```

Analyze all tickers in `data/`:

```bash
make analyze-all
```

Generate a batch summary report:

```bash
make batch TICKERS=AAPL,MSFT
```

Note: `make batch` always writes to `outputs/batch_report.json` (per `Makefile`).

## Outputs (how they work)

The pipeline always writes analysis output to disk (unless you disable saving in code).
Each run creates two files per ticker in `outputs/recommendations/`:
- `<DATE>_<TICKER>_analysis.json` (machine-readable parsed result)
- `<DATE>_<TICKER>_analysis.md` (raw LLM response for auditability)

The JSON file is the primary output consumed by downstream systems; it includes a
normalized recommendation block plus extracted section text. The `.md` file is
the exact model response, which is useful for debugging parser issues.

Analysis outputs are saved to:

```
outputs/recommendations/
  YYYYMMDD_<TICKER>_analysis.json
  YYYYMMDD_<TICKER>_analysis.md
```

The JSON file includes:

```json
{
  "ticker": "AAPL",
  "recommendation": {
    "signal": "BUY | HOLD | SELL | AVOID",
    "conviction": "VERY_HIGH | HIGH | MODERATE | LOW",
    "position_size_pct": 4.5,
    "price_target_12mo": 195,
    "stop_loss_price": 165,
    "key_catalysts": ["..."],
    "key_risks": ["..."],
    "review_trigger": "..."
  },
  "sections": {
    "executive_summary": "...",
    "fundamental_analysis": "...",
    "valuation_assessment": "...",
    "qualitative_factors": "...",
    "risk_factors": "..."
  },
  "parse_errors": [],
  "analysis_date": "2026-01-24T12:34:56.789012",
  "model": "gemini-2.5-flash"
}
```

The `.md` file is the full raw LLM response, saved for auditability.

## Prompt output format (required by parser)

The response parser expects a JSON block like the one specified in
`config/prompts/investment_philosophy.md` under "Output Format Requirements".
If the JSON block is missing or malformed, the parser falls back to heuristics,
populates whatever it can, and records warnings in `parse_errors`. Always use
the JSON in the `.json` file as the source of truth for downstream usage.

## Common troubleshooting

- "Gemini API key required": set `GEMINI_API_KEY` or add it to `.env`.
- "No data directory found": verify `data/<TICKER>` exists and is spelled exactly.
- Empty or weak recommendations: check that CSVs have a valid `date` column and
  enough recent rows; the context builder prioritizes recent data.

## Makefile command reference

```bash
make install
make setup-ticker TICKER=AAPL
make generate-data TICKER=AAPL
make list
make info TICKER=AAPL
make plot TICKER=AAPL
make plot TICKER=AAPL OUT=/tmp/aapl_charts.html
make analyze TICKER=AAPL
make analyze-all
make batch TICKERS=AAPL,MSFT
make test
make lint
make format
make clean
```
