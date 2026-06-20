#!/usr/bin/env python3
"""Generate interactive charts for fundamentals and price data."""

import argparse
import csv
from pathlib import Path
from typing import Dict, List, Any, Optional

try:
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots
    import plotly.io as pio
except ImportError as exc:  # pragma: no cover - runtime dependency
    raise SystemExit(
        "plotly is required. Install with: uv pip install plotly"
    ) from exc


def _read_csv(path: Path) -> List[Dict[str, str]]:
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        return list(reader)


def _to_float(value: Optional[str]):
    if value is None:
        return None
    value = value.strip()
    if value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _load_fundamentals(fundamentals_dir: Path) -> List[Dict[str, Any]]:
    series = []
    for path in sorted(fundamentals_dir.glob("*.csv")):
        rows = _read_csv(path)
        if not rows:
            continue
        headers = list(rows[0].keys())
        if len(headers) < 3:
            continue
        value_col = headers[2]
        if path.stem.lower() == "eps" and "eps_diluted" in headers:
            value_col = "eps_diluted"
        x = []
        y = []
        for row in rows:
            label = f"{row.get('year','')} {row.get('quarter','')}".strip()
            x.append(label)
            y.append(_to_float(row.get(value_col, "")))
        series.append({
            "name": path.stem.replace("_", " ").title(),
            "x": x,
            "y": y,
        })
    return series


def _load_timeseries(
    csv_path: Path, date_col: str = "date", include_cols: Optional[List[str]] = None
) -> Dict[str, Any]:
    rows = _read_csv(csv_path)
    if not rows:
        return {"x": [], "series": []}
    headers = list(rows[0].keys())
    if date_col not in headers:
        date_col = headers[0]
    x = [row.get(date_col, "") for row in rows]
    series = []
    for col in headers:
        if col == date_col:
            continue
        if include_cols is not None and col not in include_cols:
            continue
        y = [_to_float(row.get(col, "")) for row in rows]
        series.append({"name": col.replace("_", " ").title(), "y": y})
    return {"x": x, "series": series}


def _build_figure(
    ticker: str,
    fundamentals: List[Dict[str, Any]],
    price: Dict[str, Any],
) -> go.Figure:
    rows = max(1, len(fundamentals)) + 1
    titles = [f["name"] for f in fundamentals] + ["Daily Prices"]

    fig = make_subplots(
        rows=rows,
        cols=1,
        subplot_titles=titles,
        vertical_spacing=0.06,
    )

    row_idx = 1
    for series in fundamentals:
        fig.add_trace(
            go.Bar(
                x=series["x"],
                y=series["y"],
                name=series["name"],
                hovertemplate="%{x}<br>%{y}<extra></extra>",
                marker=dict(color="#2dd4bf"),
            ),
            row=row_idx,
            col=1,
        )
        row_idx += 1

    for s in price["series"]:
        fig.add_trace(
            go.Scatter(
                x=price["x"],
                y=s["y"],
                mode="lines",
                name=s["name"],
                hovertemplate="%{x}<br>%{y}<extra></extra>",
            ),
            row=row_idx,
            col=1,
        )

    fig.update_layout(
        title=f"{ticker} Fundamentals and Prices",
        height=320 * rows,
        template="plotly_dark",
        legend=dict(orientation="h"),
        margin=dict(t=80, l=60, r=40, b=60),
    )
    return fig


def main() -> int:
    parser = argparse.ArgumentParser(description="Interactive charts from data folder.")
    parser.add_argument("--data-dir", default="data", help="Base data directory")
    parser.add_argument("--ticker", default=None, help="Ticker symbol folder inside data dir")
    parser.add_argument("--out", default=None, help="Optional output HTML file path")
    parser.add_argument(
        "--renderer",
        default="browser",
        help="Plotly renderer (default: browser)",
    )
    parser.add_argument(
        "--open",
        dest="open_plot",
        action="store_true",
        help="Open the interactive plot window",
    )
    parser.add_argument(
        "--no-open",
        dest="open_plot",
        action="store_false",
        help="Do not open the plot window",
    )
    parser.set_defaults(open_plot=True)
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    if not data_dir.exists():
        raise SystemExit(f"Data dir not found: {data_dir}")

    if args.ticker is None:
        tickers = sorted([p.name for p in data_dir.iterdir() if p.is_dir()])
        if not tickers:
            raise SystemExit("No ticker directories found.")
        ticker = tickers[0]
    else:
        ticker = args.ticker

    ticker_dir = data_dir / ticker
    fundamentals_dir = ticker_dir / "fundamentals"
    price_path = ticker_dir / "price_data" / "daily_prices.csv"

    fundamentals = _load_fundamentals(fundamentals_dir)
    price = _load_timeseries(price_path, include_cols=["close"])

    fig = _build_figure(ticker, fundamentals, price)

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        fig.write_html(out_path)
        print(f"Wrote {out_path}")

    if args.open_plot:
        pio.renderers.default = args.renderer
        fig.show()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
