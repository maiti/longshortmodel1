from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest

from quant.backtest import get_rebalance_dates, run_backtest
from quant.data import fetch_yfinance_data, generate_synthetic_market
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


# fetch_yfinance_data parses whatever shape yfinance's group_by="ticker"
# actually returns. Locked in with mocks, not a live call: yfinance's
# column shape for a single-ticker batch has changed across versions
# (multi_level_index default), and this project has already shipped once
# with an outdated yfinance pin that failed every download silently --
# these tests catch a parsing regression even though nothing here touches
# the real, unversioned Yahoo Finance API.

def _multiindex_frame(tickers, dates):
    fields = ["Open", "High", "Low", "Close", "Volume"]
    columns = pd.MultiIndex.from_product([tickers, fields])
    data = {}
    for i, t in enumerate(tickers):
        for f in fields:
            data[(t, f)] = (
                [1_000_000.0 + i] * len(dates) if f == "Volume"
                else [100.0 + i + j * 0.1 for j in range(len(dates))]
            )
    return pd.DataFrame(data, index=dates, columns=columns)


def _flat_frame(dates):
    fields = ["Open", "High", "Low", "Close", "Volume"]
    data = {f: ([1_000_000.0] * len(dates) if f == "Volume" else [100.0 + j * 0.1 for j in range(len(dates))]) for f in fields}
    return pd.DataFrame(data, index=dates, columns=fields)


def test_fetch_yfinance_data_parses_multiindex_multi_ticker_batch():
    dates = pd.bdate_range("2020-01-01", periods=10)
    frame = _multiindex_frame(["AAA", "BBB"], dates)
    with patch("yfinance.download", return_value=frame):
        result = fetch_yfinance_data(["AAA", "BBB"], "2020-01-01", "2020-01-15", chunk_size=50, max_retries=0)
    assert sorted(result.prices.columns) == ["AAA", "BBB"]
    assert len(result.prices) == 10
    assert (result.dollar_volume > 0).all().all()


def test_fetch_yfinance_data_parses_flat_single_ticker_batch():
    # The "traditional" shape: no ticker level at all when there's one name.
    dates = pd.bdate_range("2020-01-01", periods=10)
    frame = _flat_frame(dates)
    with patch("yfinance.download", return_value=frame):
        result = fetch_yfinance_data(["AAA"], "2020-01-01", "2020-01-15", chunk_size=50, max_retries=0)
    assert list(result.prices.columns) == ["AAA"]
    assert len(result.prices) == 10


def test_fetch_yfinance_data_parses_multiindex_single_ticker_batch():
    # The shape multi_level_index=True (yfinance's current default) can
    # produce even for a single ticker -- must not be assumed away based
    # on batch size, only on the DataFrame's actual column structure.
    dates = pd.bdate_range("2020-01-01", periods=10)
    frame = _multiindex_frame(["AAA"], dates)
    with patch("yfinance.download", return_value=frame):
        result = fetch_yfinance_data(["AAA"], "2020-01-01", "2020-01-15", chunk_size=50, max_retries=0)
    assert list(result.prices.columns) == ["AAA"]
    assert len(result.prices) == 10


def test_fetch_yfinance_data_surfaces_download_error_detail():
    # A systemic failure (rate limiting, an auth change, yfinance/Yahoo
    # incompatibility) must be visible in the raised error, not just in a
    # server-side log the UI's caller may never see.
    with patch("yfinance.download", side_effect=RuntimeError("429 Too Many Requests")):
        with pytest.raises(RuntimeError, match="429 Too Many Requests"):
            fetch_yfinance_data(["AAA"], "2020-01-01", "2020-01-15", chunk_size=50, max_retries=0)
