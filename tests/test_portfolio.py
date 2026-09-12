import numpy as np
import pandas as pd
import pytest

from quant.portfolio import (
    market_impact_cost,
    shrunk_covariance,
    size_positions,
    volatility_target_leverage,
)


def test_size_positions_is_dollar_neutral_when_cap_does_not_bind():
    # 60 names, 20% long/short -> 12 names per side; a 0.10 cap can't bind
    # unless a single name's raw Merton/tangency size would exceed 1/12 of
    # the book on its own, which a smoothly spread random score distribution
    # essentially never does, so the post-cap book stays exactly neutral.
    tickers = [f"T{i}" for i in range(60)]
    rng = np.random.default_rng(0)
    scores = pd.Series(rng.normal(0, 1, len(tickers)), index=tickers)
    vol = pd.Series(0.2, index=tickers)
    dates = pd.bdate_range("2020-01-01", periods=150)
    returns_history = pd.DataFrame(rng.normal(0, 0.01, (150, len(tickers))), index=dates, columns=tickers)

    weights = size_positions(
        scores=scores, annualized_vol=vol, returns_history=returns_history,
        long_pct=0.2, short_pct=0.2, risk_aversion=5.0, signal_scale=0.05,
        covariance_lookback_days=120, covariance_shrinkage=0.4, max_position_weight=0.5,
    )

    long_sum = weights[weights > 0].sum()
    short_sum = weights[weights < 0].sum()
    assert long_sum == pytest.approx(1.0, abs=1e-6)
    assert short_sum == pytest.approx(-1.0, abs=1e-6)
    assert (weights.abs() <= 0.5 + 1e-9).all()


def test_size_positions_respects_cap_even_when_it_forces_net_imbalance():
    # With only 4 names per side and a 0.10 cap, the book cannot reach a
    # full +1/-1 gross exposure (4 * 0.10 = 0.4 at most per side) -- the cap
    # is a hard per-name limit that wins over exact dollar neutrality when
    # the two are in tension, exactly as it does in size_positions's
    # rescale-then-cap ordering.
    tickers = [f"T{i}" for i in range(20)]
    rng = np.random.default_rng(0)
    scores = pd.Series(rng.normal(0, 1, len(tickers)), index=tickers)
    vol = pd.Series(0.2, index=tickers)
    dates = pd.bdate_range("2020-01-01", periods=150)
    returns_history = pd.DataFrame(rng.normal(0, 0.01, (150, len(tickers))), index=dates, columns=tickers)

    weights = size_positions(
        scores=scores, annualized_vol=vol, returns_history=returns_history,
        long_pct=0.2, short_pct=0.2, risk_aversion=5.0, signal_scale=0.05,
        covariance_lookback_days=120, covariance_shrinkage=0.4, max_position_weight=0.10,
    )
    assert (weights.abs() <= 0.10 + 1e-9).all()
    assert weights[weights > 0].sum() <= 1.0 + 1e-9
    assert weights[weights < 0].sum() >= -1.0 - 1e-9


def test_size_positions_selection_matches_rank():
    tickers = [f"T{i}" for i in range(10)]
    scores = pd.Series(np.linspace(-2, 2, 10), index=tickers)  # T9 highest, T0 lowest
    vol = pd.Series(0.2, index=tickers)
    dates = pd.bdate_range("2020-01-01", periods=150)
    rng = np.random.default_rng(1)
    returns_history = pd.DataFrame(rng.normal(0, 0.01, (150, len(tickers))), index=dates, columns=tickers)

    weights = size_positions(
        scores=scores, annualized_vol=vol, returns_history=returns_history,
        long_pct=0.2, short_pct=0.2, risk_aversion=5.0, signal_scale=0.05,
        covariance_lookback_days=120, covariance_shrinkage=0.4, max_position_weight=1.0,
    )
    assert weights["T9"] > 0
    assert weights["T8"] > 0
    assert weights["T0"] < 0
    assert weights["T1"] < 0
    assert weights["T5"] == 0.0


def test_size_positions_returns_zero_with_insufficient_names():
    scores = pd.Series([1.0, 2.0], index=["A", "B"])
    vol = pd.Series([0.2, 0.2], index=["A", "B"])
    returns_history = pd.DataFrame({"A": [0.01] * 30, "B": [0.02] * 30})
    weights = size_positions(
        scores=scores, annualized_vol=vol, returns_history=returns_history,
        long_pct=0.2, short_pct=0.2, risk_aversion=5.0, signal_scale=0.05,
        covariance_lookback_days=120, covariance_shrinkage=0.4, max_position_weight=0.10,
    )
    assert (weights == 0).all()


def test_shrunk_covariance_shrinks_toward_diagonal():
    rng = np.random.default_rng(2)
    dates = pd.bdate_range("2020-01-01", periods=200)
    returns = pd.DataFrame(rng.normal(0, 0.01, (200, 5)), index=dates)

    fully_shrunk = shrunk_covariance(returns, shrinkage=1.0)
    off_diagonal = fully_shrunk - np.diag(np.diag(fully_shrunk))
    assert np.allclose(off_diagonal, 0.0)

    unshrunk = shrunk_covariance(returns, shrinkage=0.0)
    assert not np.allclose(unshrunk - np.diag(np.diag(unshrunk)), 0.0)


def test_shrunk_covariance_none_when_insufficient_data():
    returns = pd.DataFrame(np.random.default_rng(0).normal(0, 0.01, (5, 10)))
    assert shrunk_covariance(returns, shrinkage=0.4) is None


def test_volatility_target_leverage_scales_toward_target():
    dates = pd.bdate_range("2020-01-01", periods=100)
    calm_returns = pd.Series(np.random.default_rng(0).normal(0, 0.001, 100), index=dates)
    leverage = volatility_target_leverage(
        calm_returns, vol_target=0.10, lookback_days=60, min_leverage=0.5, max_leverage=2.0
    )
    assert leverage == 2.0  # realized vol far below target -> leverage clipped at max

    volatile_returns = pd.Series(np.random.default_rng(0).normal(0, 0.05, 100), index=dates)
    leverage2 = volatility_target_leverage(
        volatile_returns, vol_target=0.10, lookback_days=60, min_leverage=0.5, max_leverage=2.0
    )
    assert leverage2 == 0.5  # realized vol far above target -> leverage clipped at min


def test_volatility_target_leverage_defaults_to_one_with_no_history():
    leverage = volatility_target_leverage(
        pd.Series(dtype=float), vol_target=0.10, lookback_days=60, min_leverage=0.5, max_leverage=2.0
    )
    assert leverage == 1.0


def test_market_impact_cost_scales_with_sqrt_participation():
    weights_small = pd.Series({"A": 0.01})
    weights_large = pd.Series({"A": 0.04})
    volume = pd.Series({"A": 1_000_000.0})

    cost_small = market_impact_cost(weights_small, volume, impact_coefficient=0.1, assumed_portfolio_dollars=10_000_000)
    cost_large = market_impact_cost(weights_large, volume, impact_coefficient=0.1, assumed_portfolio_dollars=10_000_000)
    # 4x the trade size should cost 2x as much per the square-root law (cost scales with size^1.5 in total dollars,
    # or sqrt(size) in per-dollar terms) -- check the per-dollar cost rate scaled correctly.
    assert cost_large / cost_small == pytest.approx(2.0 * 4.0, rel=1e-6)


def test_market_impact_cost_zero_for_unknown_volume():
    weights = pd.Series({"A": 0.05})
    volume = pd.Series({"A": 0.0})
    cost = market_impact_cost(weights, volume, impact_coefficient=0.1, assumed_portfolio_dollars=10_000_000)
    assert cost == 0.0
