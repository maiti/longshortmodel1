#!/usr/bin/env python3
"""Command-line entry point: run the full model end to end and print a
report, the same one the web UI's "Math" view is built from.

Usage:
    python scripts/run_model.py
    python scripts/run_model.py --data-source yfinance --seed 42
    python scripts/run_model.py --illiquidity-weight 1.0 --momentum-weight 0 \\
        --reversal-weight 0 --volatility-weight 0

Requires: pip install -r requirements.txt
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from quant.config import ModelConfig
from quant.pipeline import print_console_report, run_full_pipeline

RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-source", choices=["synthetic", "yfinance"], default="synthetic")
    parser.add_argument("--seed", type=int, default=9)
    parser.add_argument("--start-date", default="2018-01-01")
    parser.add_argument("--end-date", default="2024-12-31")
    parser.add_argument("--train-end-date", default="2022-12-31")
    parser.add_argument("--momentum-weight", type=float, default=0.35)
    parser.add_argument("--reversal-weight", type=float, default=0.0)
    parser.add_argument("--volatility-weight", type=float, default=0.0)
    parser.add_argument("--illiquidity-weight", type=float, default=0.65)
    parser.add_argument("--risk-aversion", type=float, default=5.0)
    parser.add_argument("--vol-target", type=float, default=0.10)
    parser.add_argument("--no-cache", action="store_true", help="ignore any cached data and regenerate/redownload")
    parser.add_argument("--no-plot", action="store_true", help="skip saving equity_curve.png")
    return parser.parse_args()


def save_equity_curve(result: dict, path: Path) -> None:
    dates = pd.to_datetime(result["equity_curve"]["dates"])
    strategy = result["equity_curve"]["strategy"]
    benchmark = result["equity_curve"]["equal_weight_benchmark"]
    train_end = pd.Timestamp(result["config"]["train_end_date"])

    fig, ax = plt.subplots(figsize=(11, 5.5))
    ax.plot(dates, strategy, label="Strategy (net of costs)", linewidth=1.6, color="#2563eb")
    ax.plot(dates, benchmark, label="Equal-weight universe benchmark", linewidth=1.2, color="#94a3b8")
    if dates.min() <= train_end <= dates.max():
        ax.axvline(train_end, color="#dc2626", linestyle="--", linewidth=1, label="Train / test split")
    ax.set_title("Equity Curve: Long/Short Factor Model vs. Equal-Weight Benchmark")
    ax.set_ylabel("Growth of $1")
    ax.legend(loc="upper left")
    ax.grid(alpha=0.25)
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
    args = parse_args()

    config = ModelConfig(
        data_source=args.data_source,
        random_seed=args.seed,
        start_date=args.start_date,
        end_date=args.end_date,
        train_end_date=args.train_end_date,
        momentum_weight=args.momentum_weight,
        reversal_weight=args.reversal_weight,
        volatility_weight=args.volatility_weight,
        illiquidity_weight=args.illiquidity_weight,
        risk_aversion=args.risk_aversion,
        vol_target=args.vol_target,
    )

    result = run_full_pipeline(config, use_cache=not args.no_cache)
    print_console_report(result)

    RESULTS_DIR.mkdir(exist_ok=True)
    with open(RESULTS_DIR / "results.json", "w") as f:
        json.dump(result, f, indent=2)
    print(f"\nFull results written to {RESULTS_DIR / 'results.json'}")

    if not args.no_plot:
        save_equity_curve(result, RESULTS_DIR / "equity_curve.png")
        print(f"Equity curve chart written to {RESULTS_DIR / 'equity_curve.png'}")


if __name__ == "__main__":
    main()
