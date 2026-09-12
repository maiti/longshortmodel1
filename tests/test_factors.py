import numpy as np
import pandas as pd
import pytest

from quant.factors import (
    amihud_illiquidity,
    momentum,
    neutralize_by_sector,
    realized_volatility,
    short_term_reversal,
    zscore_cross_sectionally,
)


def _price_panel(n_days=300, tickers=("A", "B", "C", "D")):
    dates = pd.bdate_range("2020-01-01", periods=n_days)
    rng = np.random.default_rng(0)
    prices = 100 * np.exp(np.cumsum(rng.normal(0, 0.01, (n_days, len(tickers))), axis=0))
    return pd.DataFrame(prices, index=dates, columns=list(tickers))


def test_momentum_skips_recent_month():
    prices = _price_panel()
    mom = momentum(prices, lookback_days=252, skip_days=21)
    # value at date t should equal price[t-21]/price[t-252] - 1
    t = 260
    expected = prices.iloc[t - 21] / prices.iloc[t - 252] - 1
    pd.testing.assert_series_equal(mom.iloc[t], expected, check_names=False)


def test_reversal_is_negative_of_return():
    prices = _price_panel()
    rev = short_term_reversal(prices, lookback_days=5)
    raw_return = prices.pct_change(periods=5)
    pd.testing.assert_frame_equal(rev, -raw_return)


def test_realized_volatility_nonnegative():
    prices = _price_panel()
    vol = realized_volatility(prices, lookback_days=20, annualize=True)
    assert (vol.dropna() >= 0).all().all()


def test_amihud_illiquidity_higher_for_thinner_volume():
    prices = _price_panel(n_days=100, tickers=("THIN", "THICK"))
    dollar_volume = pd.DataFrame(
        {"THIN": [1_000.0] * 100, "THICK": [1_000_000.0] * 100}, index=prices.index
    )
    illiq = amihud_illiquidity(prices, dollar_volume, lookback_days=20)
    last = illiq.iloc[-1]
    assert last["THIN"] > last["THICK"]


def test_zscore_cross_sectionally_has_zero_mean_unit_std():
    rng = np.random.default_rng(1)
    raw = pd.DataFrame(rng.normal(5, 2, (10, 6)))
    z = zscore_cross_sectionally(raw)
    row_means = z.mean(axis=1)
    row_stds = z.std(axis=1)
    assert np.allclose(row_means, 0, atol=1e-9)
    assert np.allclose(row_stds, 1, atol=1e-9)


def test_neutralize_by_sector_zeroes_sector_mean():
    factor = pd.DataFrame({"A": [1.0], "B": [3.0], "C": [10.0]})
    sector_map = {"A": "tech", "B": "tech", "C": "energy"}
    neutralized = neutralize_by_sector(factor, sector_map)
    # "tech" group (A, B) should be demeaned to +/-1; "energy" (C alone) is a
    # one-member group so it demeans to exactly 0.
    assert neutralized.loc[0, "A"] == pytest.approx(-1.0)
    assert neutralized.loc[0, "B"] == pytest.approx(1.0)
    assert neutralized.loc[0, "C"] == pytest.approx(0.0)
