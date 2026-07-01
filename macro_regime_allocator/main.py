#!/usr/bin/env python3
"""
Macro Regime Allocator — Equities vs T-Bills

Predicts whether equities will outperform the risk-free rate (fed funds)
over the next N months. Converts prediction into equity/cash weights.

Usage:
    python main.py
    python main.py --predict-latest
    python main.py --model incremental --window rolling
"""

import argparse
import sys
import os
import warnings
import pandas as pd

from config import Config
from data import load_data, engineer_features, build_labels
from backtest import run_backtest, probabilities_to_weights, _gather_market_data
from results import evaluate, generate_all_plots

warnings.filterwarnings("ignore", category=FutureWarning)


def parse_args():
    parser = argparse.ArgumentParser(description="Macro Regime Allocator")
    parser.add_argument("--window", choices=["expanding", "rolling"], default=None)
    parser.add_argument("--horizon", type=int, default=None,
                        help="Forecast horizon in months (default: 1)")
    parser.add_argument("--skip-download", action="store_true")
    parser.add_argument("--predict", action="store_true",
                        help="Run only the live prediction using saved model and cached data")
    parser.add_argument("--validate", action="store_true",
                        help="Run robustness validation suite")
    return parser.parse_args()


def main():
    args = parse_args()
    cfg = Config()

    if args.window:
        cfg.window_type = args.window
    if args.horizon:
        cfg.forecast_horizon_months = args.horizon

    # ── Fast predict mode: load saved model + cached data, run inference only ──
    if args.predict:
        import numpy as np
        from model import RegimeClassifier
        merged_path = os.path.join(cfg.data_dir, "merged_monthly.csv")
        if not os.path.exists(merged_path):
            print(f"ERROR: {merged_path} not found. Run a full backtest first.")
            sys.exit(1)
        if not os.path.exists(cfg.model_path):
            print(f"ERROR: {cfg.model_path} not found. Run a full backtest first.")
            sys.exit(1)

        merged = pd.read_csv(merged_path, index_col="date", parse_dates=True)
        # Extend one lag into the future so we predict the UPCOMING month from
        # the newest data, not the last data month.
        features = engineer_features(merged, cfg, extend_for_live=True)
        model = RegimeClassifier(cfg)
        model.load_model()

        # Use the latest month with a COMPLETE feature set — if the newest month
        # is missing a not-yet-published series, fall back rather than failing.
        model_feats = features.reindex(columns=model.feature_names)
        complete = model_feats.dropna()
        if complete.empty:
            print(f"ERROR: No month has a complete feature set.")
            sys.exit(1)
        latest_date = complete.index[-1]
        latest_features = complete.iloc[[-1]]
        newest = model_feats.index[-1]
        if latest_date != newest:
            missing = model_feats.columns[model_feats.loc[newest].isna()].tolist()
            print(f"  NOTE: newest month {newest.strftime('%Y-%m')} incomplete "
                  f"(missing {missing}); using latest complete month "
                  f"{latest_date.strftime('%Y-%m')}.")

        proba = model.predict_proba(latest_features)[0]
        # Unlagged market signals from the latest real data month (the extended
        # feature month is not present in merged).
        market_data = _gather_market_data(merged, merged.index[-1])
        _, weights, overlay_reason = probabilities_to_weights(proba, cfg, market_data)

        # Read last backtest weight for smoothing
        bt_path = os.path.join(cfg.output_dir, "backtest_results.csv")
        if os.path.exists(bt_path):
            bt_saved = pd.read_csv(bt_path, index_col="date", parse_dates=True)
            prev_eq = bt_saved["weight_equity"].dropna().iloc[-1]
        else:
            prev_eq = cfg.equal_weight[0]
        target_eq = weights[0]
        alpha = cfg.weight_smoothing_up if target_eq >= prev_eq else cfg.weight_smoothing_down
        smoothed_eq = np.clip(alpha * target_eq + (1 - alpha) * prev_eq,
                              cfg.min_weight, cfg.max_weight)
        weights = np.array([smoothed_eq, 1.0 - smoothed_eq])

        data_as_of = latest_date - pd.DateOffset(months=cfg.macro_lag_months)
        allocation_month = latest_date
        print(f"\n╔══════════════════════════════════════════════════════════════╗")
        print(f"║               CURRENT ALLOCATION SIGNAL                     ║")
        print(f"╚══════════════════════════════════════════════════════════════╝")
        print(f"  Data as of:              {data_as_of.strftime('%Y-%m')}")
        print(f"  Allocation for:          {allocation_month.strftime('%Y-%m')}")
        print(f"  P(equity beats T-bills): {proba[0]:.3f}")
        print(f"  P(T-bills win):          {proba[1]:.3f}")
        print(f"  Crash overlay:           {overlay_reason}")
        if market_data:
            print(f"  Market signals:")
            for k, v in sorted(market_data.items()):
                print(f"    {k:>28s}: {v:+.2f}")
        print(f"")
        print(f"  ┌─────────────────────────────────┐")
        print(f"  │  RECOMMENDED ALLOCATION          │")
        for i, name in enumerate(cfg.asset_classes):
            bar_len = int(weights[i] * 20)
            bar = "█" * bar_len + "░" * (20 - bar_len)
            print(f"  │  {name:>8s}: {weights[i]:6.1%}  {bar} │")
        print(f"  └─────────────────────────────────┘")

        # Save live prediction so the web UI can serve it
        import json
        live_pred = {
            "rebalance_date": data_as_of.strftime("%Y-%m-%d"),
            "allocation_month": allocation_month.strftime("%Y-%m-%d"),
            "prob_equity": float(proba[0]),
            "prob_tbills": float(proba[1]),
            "weight_equity": float(weights[0]),
            "weight_tbills": float(weights[1]),
            "overlay": overlay_reason,
            "market_signals": {k: float(v) for k, v in sorted(market_data.items())} if market_data else {},
        }
        os.makedirs(cfg.output_dir, exist_ok=True)
        with open(os.path.join(cfg.output_dir, "live_prediction.json"), "w") as f:
            json.dump(live_pred, f, indent=2)
        print(f"  Saved live prediction to {cfg.output_dir}/live_prediction.json")
        return

    print("=" * 60)
    print("  MACRO REGIME ALLOCATOR — Equities vs T-Bills")
    print("=" * 60)
    print(f"  Equity proxy:  {cfg.asset_tickers['equity']}")
    print(f"  T-Bills:       fed funds rate")
    print(f"  Horizon:       {cfg.forecast_horizon_months} months")
    print(f"  Window:        {cfg.window_type}")
    print(f"  Start date:    {cfg.start_date}  (data from {cfg.data_start_date})")
    print(f"  Min train:     {cfg.min_train_months} months (auto-backdated)")
    print("=" * 60)

    # Step 1: Load data
    if args.skip_download:
        print("\nLoading cached data...")
        merged_path = os.path.join(cfg.data_dir, "merged_monthly.csv")
        if not os.path.exists(merged_path):
            print(f"ERROR: {merged_path} not found. Run without --skip-download first.")
            sys.exit(1)
        merged = pd.read_csv(merged_path, index_col="date", parse_dates=True)
    else:
        print("\n── Step 1: Load Data ──────────────────────────────────────")
        merged = load_data(cfg)

    # Step 2: Features
    print("\n── Step 2: Feature Engineering ────────────────────────────")
    features = engineer_features(merged, cfg)

    # Step 3: Labels
    print("\n── Step 3: Build Labels ──────────────────────────────────")
    labels = build_labels(merged, cfg)

    # Step 4: Backtest
    print("\n── Step 4: Walk-Forward Backtest ──────────────────────────")
    results = run_backtest(features, labels, cfg)
    bt = results["backtest"]
    final_model = results["final_model"]

    # Step 5: Live prediction (always runs)
    print("\n── Step 5: Live Prediction ───────────────────────────────")
    import numpy as np

    # Build features extended one lag into the future so the newest DATA month
    # (e.g. June) produces a prediction for the UPCOMING month (July) rather than
    # the last data month. If the newest month is missing a not-yet-published
    # series, fall back to the most recent month with a COMPLETE feature set
    # rather than skipping the live prediction (which leaves the UI stale).
    live_features = engineer_features(merged, cfg, extend_for_live=True)
    model_feats = live_features.reindex(columns=final_model.feature_names)
    complete = model_feats.dropna()
    if complete.empty:
        print(f"  WARNING: No month has a complete feature set; skipping live prediction.")
    else:
        latest_date = complete.index[-1]
        latest_features = complete.iloc[[-1]]
        newest = model_feats.index[-1]
        if latest_date != newest:
            missing = model_feats.columns[model_feats.loc[newest].isna()].tolist()
            print(f"  NOTE: newest month {newest.strftime('%Y-%m')} incomplete "
                  f"(missing {missing}); using latest complete month "
                  f"{latest_date.strftime('%Y-%m')}.")
        proba = final_model.predict_proba(latest_features)[0]
        pred_class = np.argmax(proba)
        # Current (unlagged) market signals come from the latest REAL data month,
        # which is the last row actually present in merged (the extended feature
        # month is not in merged).
        market_data = _gather_market_data(merged, merged.index[-1])
        _, weights, overlay_reason = probabilities_to_weights(proba, cfg, market_data)

        # Smooth against last backtest weight
        prev_eq = results.get("prev_equity_weight", cfg.equal_weight[0])
        target_eq = weights[0]
        alpha = cfg.weight_smoothing_up if target_eq >= prev_eq else cfg.weight_smoothing_down
        smoothed_eq = np.clip(alpha * target_eq + (1 - alpha) * prev_eq,
                              cfg.min_weight, cfg.max_weight)
        weights = np.array([smoothed_eq, 1.0 - smoothed_eq])

        data_as_of = latest_date - pd.DateOffset(months=cfg.macro_lag_months)
        allocation_month = latest_date
        print(f"  Data as of:              {data_as_of.strftime('%Y-%m')}")
        print(f"  Allocation for:          {allocation_month.strftime('%Y-%m')}")
        print(f"  P(equity beats T-bills): {proba[0]:.3f}")
        print(f"  P(T-bills win):          {proba[1]:.3f}")
        print(f"  Crash overlay:           {overlay_reason}")
        if market_data:
            print(f"  Market signals:")
            for k, v in sorted(market_data.items()):
                print(f"    {k:>28s}: {v:+.2f}")
        print(f"")
        print(f"  ┌─────────────────────────────────┐")
        print(f"  │  RECOMMENDED ALLOCATION          │")
        for i, name in enumerate(cfg.asset_classes):
            bar_len = int(weights[i] * 20)
            bar = "█" * bar_len + "░" * (20 - bar_len)
            print(f"  │  {name:>8s}: {weights[i]:6.1%}  {bar} │")
        print(f"  └─────────────────────────────────┘")

        # Save live prediction so the web UI can serve it
        import json
        live_pred = {
            "rebalance_date": data_as_of.strftime("%Y-%m-%d"),
            "allocation_month": allocation_month.strftime("%Y-%m-%d"),
            "prob_equity": float(proba[0]),
            "prob_tbills": float(proba[1]),
            "weight_equity": float(weights[0]),
            "weight_tbills": float(weights[1]),
            "overlay": overlay_reason,
            "market_signals": {k: float(v) for k, v in sorted(market_data.items())} if market_data else {},
        }
        os.makedirs(cfg.output_dir, exist_ok=True)
        with open(os.path.join(cfg.output_dir, "live_prediction.json"), "w") as f:
            json.dump(live_pred, f, indent=2)
        print(f"  Saved live prediction to {cfg.output_dir}/live_prediction.json")

    # Step 6: Evaluate
    print("\n── Step 6: Evaluation ────────────────────────────────────")
    eval_results = evaluate(bt, final_model, cfg)

    # Step 7: Plots
    print("\n── Step 7: Generate Plots ────────────────────────────────")
    generate_all_plots(bt, eval_results, cfg)

    # Robustness validation suite
    if args.validate:
        from validate import run_validation
        print("\n── Step 8: Robustness Validation ─────────────────────────")
        run_validation(features, labels, cfg)

    print("\n" + "=" * 60)
    print("  DONE")
    print("=" * 60)
    print(f"  Results: {cfg.output_dir}/")
    print(f"  Plots:   {cfg.plot_dir}/")
    print("=" * 60)


if __name__ == "__main__":
    main()
