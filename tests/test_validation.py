import numpy as np
import pandas as pd
import pytest

from quant.validation import (
    information_coefficient,
    max_drawdown,
    performance_summary,
    train_test_split_summary,
    walk_forward_analysis,
)


def test_performance_summary_known_sharpe():
    # constant daily return of 0.001 with zero variance is degenerate (std=0),
    # so use a tiny controlled amount of noise instead.
    rng = np.random.default_rng(0)
    dates = pd.bdate_range("2020-01-01", periods=1000)
    daily = pd.Series(0.0005 + rng.normal(0, 0.0001, 1000), index=dates)
    summary = performance_summary(daily, "test")
    assert summary["sharpe"] > 0
    assert summary["n_days"] == 1000
    assert summary["significant_at_95"] is True  # huge, obvious signal-to-noise here


def test_performance_summary_handles_degenerate_series():
    summary = performance_summary(pd.Series([0.0, 0.0, 0.0]), "flat")
    assert summary["sharpe"] == 0.0
    assert summary["significant_at_95"] is False


def test_max_drawdown_is_negative_or_zero():
    dates = pd.bdate_range("2020-01-01", periods=5)
    returns = pd.Series([0.1, -0.2, 0.05, -0.1, 0.02], index=dates)
    dd = max_drawdown(returns)
    assert dd <= 0


def test_train_test_split_uses_correct_boundary():
    dates = pd.bdate_range("2020-01-01", periods=500)
    returns = pd.Series(np.random.default_rng(0).normal(0.0005, 0.01, 500), index=dates)
    split_date = dates[250]
    result = train_test_split_summary(returns, split_date.strftime("%Y-%m-%d"))
    assert result["in_sample"]["n_days"] == 251  # inclusive of split date
    assert result["out_of_sample"]["n_days"] == 500 - 251


def test_information_coefficient_detects_perfect_signal():
    tickers = [f"T{i}" for i in range(20)]
    all_dates = pd.bdate_range("2020-01-01", periods=100)
    rebalance_dates = list(all_dates[::25])  # 4 evenly spaced rebalance dates

    rng = np.random.default_rng(0)
    score_values = rng.normal(0, 1, (len(rebalance_dates), len(tickers)))
    factor_df = pd.DataFrame(0.0, index=all_dates, columns=tickers)
    for i, d in enumerate(rebalance_dates):
        factor_df.loc[d] = score_values[i]

    # Build a price path where each rebalance-to-rebalance segment's total
    # return is exactly proportional to that period's factor score, so the
    # rank correlation between score and forward return is exactly 1.
    prices = pd.DataFrame(index=all_dates, columns=tickers, dtype=float)
    prices.iloc[0] = 100.0
    for i in range(len(rebalance_dates) - 1):
        d, next_d = rebalance_dates[i], rebalance_dates[i + 1]
        segment = all_dates[(all_dates >= d) & (all_dates <= next_d)]
        n_steps = len(segment) - 1
        total_return = score_values[i] * 0.01  # perfectly monotonic in score
        step_growth = (1 + total_return) ** (1 / n_steps)
        start_price = prices.loc[d]
        for j, day in enumerate(segment[1:], start=1):
            prices.loc[day] = start_price * (step_growth ** j)

    ic_table = information_coefficient({"perfect": factor_df}, prices, rebalance_dates)
    assert ic_table.loc["perfect", "mean_ic"] == pytest.approx(1.0, abs=1e-6)


def test_walk_forward_analysis_splits_by_train_end_date():
    dates = pd.bdate_range("2020-01-01", periods=500)
    returns = pd.Series(np.random.default_rng(1).normal(0.0003, 0.01, 500), index=dates)
    train_end = dates[250].strftime("%Y-%m-%d")
    result = walk_forward_analysis(returns, window_months=3, train_end_date=train_end)
    assert result["in_sample"]["n_windows"] + result["out_of_sample"]["n_windows"] == result["pooled"]["n_windows"]
    assert result["pooled"]["n_windows"] == len(result["windows"])
    for w in result["windows"]:
        assert isinstance(w["in_sample"], bool)
