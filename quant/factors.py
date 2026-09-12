"""Per-stock factor computations.

Each function takes wide (date x ticker) DataFrames and returns a wide
DataFrame of the same shape: one factor value per stock, per date. Nothing
here picks stocks or sizes positions — that split matters, because it lets
`validation.information_coefficient` measure whether a factor's ranking
predicts anything, completely independent of how a portfolio is later
built on top of it.

Four factors, matching the standard cross-sectional equity factor
literature:

    momentum      12-month return, skipping the most recent month (the
                  skip avoids blending momentum with short-term reversal,
                  which point in opposite directions over the last few
                  weeks)
    reversal      negative of the trailing 1-week return
    low_vol       negative of trailing realized volatility
    illiquidity   Amihud illiquidity: mean(|daily return| / dollar volume)
                  over the lookback window — a higher value means a given
                  amount of trading moves the price more, i.e. the stock
                  is harder to trade in size
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def daily_returns(prices: pd.DataFrame) -> pd.DataFrame:
    return prices.pct_change()


def momentum(prices: pd.DataFrame, lookback_days: int, skip_days: int) -> pd.DataFrame:
    """Return from (lookback_days) trading days ago to (skip_days) trading
    days ago, per stock. Higher is more positive momentum.
    """
    lagged = prices.shift(skip_days)
    return lagged.pct_change(periods=lookback_days - skip_days)


def short_term_reversal(prices: pd.DataFrame, lookback_days: int) -> pd.DataFrame:
    """Negative of the trailing return over `lookback_days`. A stock that
    just fell scores high (expected to bounce); one that just spiked
    scores low (expected to give some of it back).
    """
    return -prices.pct_change(periods=lookback_days)


def realized_volatility(prices: pd.DataFrame, lookback_days: int, annualize: bool = False) -> pd.DataFrame:
    """Rolling standard deviation of daily returns, optionally annualized.
    This is the raw sigma other modules need (e.g. as an input to position
    sizing); see `low_volatility_factor` for the negated, standardized
    version used as a ranking signal.
    """
    vol = daily_returns(prices).rolling(window=lookback_days).std()
    return vol * np.sqrt(252) if annualize else vol


def low_volatility_factor(prices: pd.DataFrame, lookback_days: int) -> pd.DataFrame:
    """Negative of realized volatility, so calmer stocks score higher."""
    return -realized_volatility(prices, lookback_days)


def amihud_illiquidity(prices: pd.DataFrame, dollar_volume: pd.DataFrame, lookback_days: int) -> pd.DataFrame:
    """Mean, over the lookback window, of |daily return| / dollar volume.
    A higher score means less liquid; used as-is (higher = more favored
    for the long side) since illiquidity has historically earned a
    premium as compensation for the extra cost and risk of trading it.
    """
    move_per_dollar = daily_returns(prices).abs() / dollar_volume.replace(0, np.nan)
    return move_per_dollar.rolling(window=lookback_days).mean()


def zscore_cross_sectionally(factor: pd.DataFrame) -> pd.DataFrame:
    """Standardize each factor across stocks, per date (row-wise z-score),
    so factors on unrelated scales (a percent return vs. a probability-like
    illiquidity ratio) can be combined without the largest-magnitude one
    silently dominating.
    """
    row_mean = factor.mean(axis=1)
    row_std = factor.std(axis=1).replace(0, np.nan)
    return factor.sub(row_mean, axis=0).div(row_std, axis=0)


def neutralize_by_sector(factor: pd.DataFrame, sector_map: dict[str, str]) -> pd.DataFrame:
    """Subtract each stock's sector-average score at every date, so ranking
    happens within sector rather than against the whole market. A ticker
    missing from sector_map is treated as its own one-member sector (its
    mean is itself, so it is a no-op) rather than dropped.
    """
    sectors = pd.Series({t: sector_map.get(t, t) for t in factor.columns})
    return factor.T.groupby(sectors).transform(lambda g: g - g.mean()).T


def compute_all_factors(
    prices: pd.DataFrame,
    dollar_volume: pd.DataFrame,
    momentum_lookback_days: int,
    momentum_skip_days: int,
    reversal_lookback_days: int,
    volatility_lookback_days: int,
    illiquidity_lookback_days: int,
) -> dict[str, pd.DataFrame]:
    """Compute the four raw factors and cross-sectionally standardize each
    one. Returns a dict keyed by factor name; kept separate from combining
    them into a composite score so each factor's standalone predictive
    power can be measured on its own (see validation.information_coefficient).
    """
    raw = {
        "momentum": momentum(prices, momentum_lookback_days, momentum_skip_days),
        "reversal": short_term_reversal(prices, reversal_lookback_days),
        "low_vol": low_volatility_factor(prices, volatility_lookback_days),
        "illiquidity": amihud_illiquidity(prices, dollar_volume, illiquidity_lookback_days),
    }
    return {name: zscore_cross_sectionally(df) for name, df in raw.items()}
