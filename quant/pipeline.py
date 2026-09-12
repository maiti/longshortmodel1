"""Wires data, factors, portfolio construction, the backtest engine, and
every validation layer into one reproducible run.

`run_full_pipeline(config)` is the one function both the CLI script and
the web API call — it is the only place that decides, structurally, which
dates the Information Coefficient analysis is allowed to see (in-sample
rebalance dates only, computed and fixed *before* the backtest that uses
those same factor weights is even run), so that boundary is enforced by
the code path itself rather than left to the discipline of whoever is
tuning it.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from quant.backtest import get_rebalance_dates, run_backtest
from quant.config import ModelConfig
from quant.data import load_price_data
from quant.factors import compute_all_factors, realized_volatility
from quant.portfolio import combine_factor_scores
from quant.universe import SECTOR_MAP, TICKERS
from quant.validation import (
    information_coefficient,
    train_test_split_summary,
    walk_forward_analysis,
)

FACTOR_WEIGHT_FIELDS = {
    "momentum": "momentum_weight",
    "reversal": "reversal_weight",
    "low_vol": "volatility_weight",
    "illiquidity": "illiquidity_weight",
}


def _json_safe(value: Any) -> Any:
    """Recursively convert numpy/pandas types into plain JSON-serializable
    Python types, mapping NaN/Inf to None since JSON has no such literal.
    """
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, (pd.Timestamp,)):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        f = float(value)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, pd.Series):
        return _json_safe(value.to_dict())
    return value


def run_full_pipeline(config: ModelConfig, use_cache: bool = True) -> dict[str, Any]:
    tickers = config.tickers or TICKERS

    price_data = load_price_data(
        tickers=tickers,
        sector_map=SECTOR_MAP,
        start=config.start_date,
        end=config.end_date,
        source=config.data_source,
        seed=config.random_seed,
        use_cache=use_cache,
    )
    prices, dollar_volume = price_data.prices, price_data.dollar_volume

    factor_scores = compute_all_factors(
        prices=prices,
        dollar_volume=dollar_volume,
        momentum_lookback_days=config.momentum_lookback_days,
        momentum_skip_days=config.momentum_skip_days,
        reversal_lookback_days=config.reversal_lookback_days,
        volatility_lookback_days=config.volatility_lookback_days,
        illiquidity_lookback_days=config.illiquidity_lookback_days,
    )

    factor_weights = {name: getattr(config, field) for name, field in FACTOR_WEIGHT_FIELDS.items()}
    composite_scores = combine_factor_scores(factor_scores, factor_weights, config.sector_neutral_scoring)
    annualized_vol = realized_volatility(prices, config.volatility_lookback_days, annualize=True)

    all_rebalance_dates = get_rebalance_dates(prices, config.rebalance_freq)
    train_end = pd.Timestamp(config.train_end_date)
    in_sample_rebalance_dates = [d for d in all_rebalance_dates if d <= train_end]

    # Information Coefficient is computed on in-sample rebalance dates only
    # — see the module docstring for why this ordering matters. It never
    # feeds back into factor_weights automatically; a human (or, for a
    # demo run, whoever set config.*_weight) is expected to have already
    # looked at an IC table like this one before committing to those
    # weights, on a previous run.
    ic_table = information_coefficient(factor_scores, prices, in_sample_rebalance_dates)

    backtest_result = run_backtest(
        prices=prices,
        dollar_volume=dollar_volume,
        composite_scores=composite_scores,
        annualized_vol=annualized_vol,
        rebalance_freq=config.rebalance_freq,
        long_pct=config.long_pct,
        short_pct=config.short_pct,
        risk_aversion=config.risk_aversion,
        signal_scale=config.signal_scale,
        covariance_lookback_days=config.covariance_lookback_days,
        covariance_shrinkage=config.covariance_shrinkage,
        max_position_weight=config.max_position_weight,
        vol_target=config.vol_target,
        vol_target_lookback_days=config.vol_target_lookback_days,
        vol_target_min_leverage=config.vol_target_min_leverage,
        vol_target_max_leverage=config.vol_target_max_leverage,
        market_impact_coefficient=config.market_impact_coefficient,
        market_impact_lookback_days=config.market_impact_lookback_days,
        assumed_portfolio_dollars=config.assumed_portfolio_dollars,
    )

    split_summary = train_test_split_summary(backtest_result.daily_returns, config.train_end_date)
    walk_forward = walk_forward_analysis(
        backtest_result.daily_returns, config.walk_forward_window_months, config.train_end_date
    )

    equity_curve = (1 + backtest_result.daily_returns.fillna(0)).cumprod()
    benchmark_equity_curve = (1 + prices.pct_change().mean(axis=1).fillna(0)).cumprod()

    avg_turnover = float(np.mean(list(backtest_result.turnover_history.values()))) if backtest_result.turnover_history else 0.0
    total_cost_drag = float(sum(backtest_result.cost_history.values()))

    last_rebalance_date = all_rebalance_dates[-1] if all_rebalance_dates else None
    holdings_snapshot = []
    if last_rebalance_date is not None and last_rebalance_date in backtest_result.weights_history:
        weights = backtest_result.weights_history[last_rebalance_date]
        nonzero = weights[weights != 0].sort_values(ascending=False)
        for ticker, weight in nonzero.items():
            holdings_snapshot.append({
                "ticker": ticker,
                "sector": SECTOR_MAP.get(ticker, "Unknown"),
                "weight": float(weight),
                "side": "long" if weight > 0 else "short",
                "composite_score": float(composite_scores.loc[last_rebalance_date, ticker]),
            })

    result = {
        "config": config.to_dict(),
        "universe_size": prices.shape[1],
        "n_trading_days": prices.shape[0],
        "date_range": {
            "start": prices.index.min().strftime("%Y-%m-%d") if len(prices.index) else None,
            "end": prices.index.max().strftime("%Y-%m-%d") if len(prices.index) else None,
        },
        "information_coefficient": ic_table.reset_index().rename(columns={"index": "factor"}).to_dict(orient="records"),
        "performance": split_summary,
        "walk_forward": walk_forward,
        "equity_curve": {
            "dates": [d.strftime("%Y-%m-%d") for d in equity_curve.index],
            "strategy": equity_curve.tolist(),
            "equal_weight_benchmark": benchmark_equity_curve.tolist(),
        },
        "turnover": {
            "average_per_rebalance": avg_turnover,
            "history": {d.strftime("%Y-%m-%d"): v for d, v in backtest_result.turnover_history.items()},
        },
        "leverage_history": {d.strftime("%Y-%m-%d"): v for d, v in backtest_result.leverage_history.items()},
        "cost_history": {d.strftime("%Y-%m-%d"): v for d, v in backtest_result.cost_history.items()},
        "total_cost_drag": total_cost_drag,
        "current_holdings": holdings_snapshot,
        "sector_map": SECTOR_MAP,
    }
    return _json_safe(result)


def print_console_report(result: dict[str, Any]) -> None:
    """A terminal-friendly rendering of the same result dict the web UI
    consumes, so `python scripts/run_model.py` is useful on its own
    without ever touching the web app.
    """
    print("=" * 72)
    print("LONG/SHORT EQUITY FACTOR MODEL — RUN REPORT")
    print("=" * 72)
    print(f"Universe: {result['universe_size']} tickers | "
          f"{result['n_trading_days']} trading days | "
          f"{result['date_range']['start']} to {result['date_range']['end']}")
    print(f"Data source: {result['config']['data_source']}")

    print("\nInformation Coefficient (in-sample rebalance dates only)")
    print("-" * 72)
    print(f"{'factor':<12}{'mean IC':>10}{'IC std':>10}{'IC IR':>10}{'% positive':>12}{'periods':>9}")
    for row in result["information_coefficient"]:
        print(
            f"{row['factor']:<12}{row['mean_ic'] or 0:>10.4f}{row['ic_std'] or 0:>10.4f}"
            f"{row['ic_ir'] or 0:>10.4f}{(row['pct_positive'] or 0):>11.1%}{row['n_periods']:>9}"
        )

    print("\nPerformance")
    print("-" * 72)
    for key in ("full_period", "in_sample", "out_of_sample"):
        p = result["performance"][key]
        sig = "significant" if p["significant_at_95"] else "NOT significant"
        print(
            f"{p['label']:<16} Sharpe {p['sharpe']:>6.2f}  (t={p['t_stat']:>5.2f}, {sig})  "
            f"ann.ret {p['annualized_return']:>7.2%}  max DD {p['max_drawdown']:>7.2%}  n={p['n_days']}"
        )

    print("\nWalk-Forward Analysis (windows of "
          f"{result['config']['walk_forward_window_months']} months)")
    print("-" * 72)
    for key, title in (("pooled", "Pooled (all windows)"), ("in_sample", "In-sample windows"), ("out_of_sample", "Out-of-sample windows")):
        agg = result["walk_forward"][key]
        print(f"{title:<24} mean Sharpe {agg['mean_sharpe'] or 0:>6.2f}  "
              f"% positive {(agg['pct_positive'] or 0):>6.1%}  windows={agg['n_windows']}")
    print("\nNote: the out-of-sample-only row above is the one that actually answers")
    print("whether this strategy has a real edge. Pooled numbers can be inflated by a")
    print("strong in-sample stretch even when out-of-sample performance is weak.")

    print(f"\nAverage turnover per rebalance: {result['turnover']['average_per_rebalance']:.1%}")
    print(f"Total cost drag over full backtest: {result['total_cost_drag']:.2%}")
    print("=" * 72)
