import numpy as np
import pandas as pd

from quant.backtest import get_rebalance_dates, run_backtest
from quant.data import generate_synthetic_market
from quant.universe import SECTOR_MAP, TICKERS


def test_synthetic_market_is_deterministic_given_seed():
    a = generate_synthetic_market(TICKERS[:10], SECTOR_MAP, "2020-01-01", "2021-01-01", seed=42)
    b = generate_synthetic_market(TICKERS[:10], SECTOR_MAP, "2020-01-01", "2021-01-01", seed=42)
    pd.testing.assert_frame_equal(a.prices, b.prices)
    pd.testing.assert_frame_equal(a.dollar_volume, b.dollar_volume)


def test_synthetic_market_different_seeds_differ():
    a = generate_synthetic_market(TICKERS[:10], SECTOR_MAP, "2020-01-01", "2021-01-01", seed=1)
    b = generate_synthetic_market(TICKERS[:10], SECTOR_MAP, "2020-01-01", "2021-01-01", seed=2)
    assert not a.prices.equals(b.prices)


def test_synthetic_market_prices_stay_positive():
    data = generate_synthetic_market(TICKERS, SECTOR_MAP, "2018-01-01", "2024-12-31", seed=9)
    assert (data.prices > 0).all().all()
    assert (data.dollar_volume >= 0).all().all()
    assert not data.prices.isna().any().any()


def test_get_rebalance_dates_are_all_in_price_index():
    dates = pd.bdate_range("2020-01-01", periods=300)
    prices = pd.DataFrame(100.0, index=dates, columns=["A", "B"])
    rebal = get_rebalance_dates(prices, "ME")
    assert all(d in prices.index for d in rebal)
    assert len(rebal) > 0


def test_run_backtest_produces_full_length_return_series():
    data = generate_synthetic_market(TICKERS[:30], SECTOR_MAP, "2019-01-01", "2021-12-31", seed=3)
    prices, dv = data.prices, data.dollar_volume
    composite = pd.DataFrame(
        np.random.default_rng(0).normal(0, 1, prices.shape), index=prices.index, columns=prices.columns
    )
    vol = prices.pct_change().rolling(60).std() * np.sqrt(252)

    result = run_backtest(
        prices=prices, dollar_volume=dv, composite_scores=composite, annualized_vol=vol,
        rebalance_freq="ME", long_pct=0.2, short_pct=0.2, risk_aversion=5.0, signal_scale=0.05,
        covariance_lookback_days=120, covariance_shrinkage=0.4, max_position_weight=0.10,
        vol_target=0.10, vol_target_lookback_days=60, vol_target_min_leverage=0.5, vol_target_max_leverage=2.0,
        market_impact_coefficient=0.1, market_impact_lookback_days=20, assumed_portfolio_dollars=10_000_000.0,
    )
    assert len(result.daily_returns) == len(prices)
    assert len(result.weights_history) > 0
    # Every held weight should respect the per-name cap once vol-targeting
    # leverage is applied (leverage can push a capped name above its
    # nominal cap, since it's a book-wide overlay, not a per-name limit --
    # see quant.backtest.run_backtest).
    max_leverage = 2.0
    for w in result.weights_history.values():
        assert (w.abs() <= 0.10 * max_leverage + 1e-9).all()
