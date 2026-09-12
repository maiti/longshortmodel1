"""Turning factor scores into an actual dollar-neutral book: which names
to hold, how large each position is, how much leverage the whole book
runs, and what it costs to trade into it.

The math in one paragraph: stock selection ranks the composite score and
takes the top/bottom slices. Sizing within those slices generalizes the
single-asset Merton fraction

    w = (mu - r) / (gamma * sigma^2)

to its multivariate, portfolio-Sharpe-maximizing form, the tangency
portfolio:

    w = (1 / gamma) * Sigma^-1 * (mu - r)

where Sigma is the covariance matrix across the selected names instead of
one stock's own variance. Two names with identical scores that move
together get sized down relative to two names with identical scores that
move independently, because the covariance matrix "knows" they are not
really two separate bets.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from quant.universe import SECTOR_MAP


def combine_factor_scores(
    factor_scores: dict[str, pd.DataFrame],
    weights: dict[str, float],
    sector_neutral: bool,
) -> pd.DataFrame:
    """Weighted sum of already-standardized factor scores into one
    composite score per stock per date, optionally demeaned within sector.
    """
    from quant.factors import neutralize_by_sector

    composite = sum(weights[name] * factor_scores[name] for name in factor_scores)
    if sector_neutral:
        composite = neutralize_by_sector(composite, SECTOR_MAP)
    return composite


def shrunk_covariance(returns_window: pd.DataFrame, shrinkage: float) -> np.ndarray | None:
    """Annualized covariance matrix for a fixed set of stocks, shrunk
    toward its own diagonal. Shrinkage trades off estimation noise (a raw
    sample covariance from a short window is unstable, especially as the
    number of names approaches the number of observations) against bias
    (a fully diagonal matrix pretends correlation doesn't exist). Returns
    None when there isn't enough clean history to estimate a matrix at all.
    """
    clean = returns_window.dropna(how="any")
    n_obs, n_assets = clean.shape
    if n_obs < max(20, n_assets + 5):
        return None

    sample_cov = clean.cov().values * 252
    diagonal_only = np.diag(np.diag(sample_cov))
    shrunk = (1 - shrinkage) * sample_cov + shrinkage * diagonal_only
    ridge = 1e-8 * np.eye(n_assets)
    return shrunk + ridge


def size_positions(
    scores: pd.Series,
    annualized_vol: pd.Series,
    returns_history: pd.DataFrame,
    long_pct: float,
    short_pct: float,
    risk_aversion: float,
    signal_scale: float,
    covariance_lookback_days: int,
    covariance_shrinkage: float,
    max_position_weight: float,
) -> pd.Series:
    """One rebalance's worth of dollar-neutral weights: select the top
    `long_pct` / bottom `short_pct` of stocks by composite score, then size
    them with the tangency-portfolio rule described in the module
    docstring.

    `scores` is the composite score for every stock as of the rebalance
    date; `annualized_vol` is each stock's own trailing annualized
    volatility (used as a sizing fallback when the covariance matrix can't
    be estimated); `returns_history` is the full daily-return panel up to
    and including the rebalance date, from which the trailing covariance
    window is sliced.
    """
    combined = pd.concat([scores, annualized_vol], axis=1, keys=["score", "vol"]).dropna()
    combined = combined[combined["vol"] > 0]
    weights = pd.Series(0.0, index=scores.index)
    if len(combined) < 10:
        return weights

    n_long = max(1, int(len(combined) * long_pct))
    n_short = max(1, int(len(combined) * short_pct))
    ranked = combined["score"].sort_values(ascending=False)
    long_names = ranked.index[:n_long]
    short_names = ranked.index[-n_short:]
    selected = long_names.union(short_names)

    expected_excess_return = combined.loc[selected, "score"] * signal_scale
    window = returns_history.loc[:, selected].tail(covariance_lookback_days)
    cov = shrunk_covariance(window, covariance_shrinkage)

    if cov is None:
        annual_variance = combined.loc[selected, "vol"] ** 2
        raw_size = expected_excess_return / (risk_aversion * annual_variance)
    else:
        try:
            solved = np.linalg.solve(cov, expected_excess_return.values / risk_aversion)
        except np.linalg.LinAlgError:
            solved = np.linalg.lstsq(cov, expected_excess_return.values / risk_aversion, rcond=None)[0]
        raw_size = pd.Series(solved, index=selected)

    # Stock selection (long vs. short) stays entirely the factor model's
    # decision; the tangency solution can in principle want to flip a
    # name's sign when correlations are strong, so magnitudes are taken
    # and the rank-based sign is reapplied, keeping that decision boundary
    # intact regardless of what the covariance matrix estimated.
    long_raw = raw_size.loc[long_names].clip(lower=0.0)
    short_raw = raw_size.loc[short_names].clip(upper=0.0).abs()
    weights.loc[long_names] = long_raw
    weights.loc[short_names] = -short_raw

    long_sum = weights[weights > 0].sum()
    short_sum = weights[weights < 0].sum()
    if long_sum > 0:
        weights[weights > 0] *= 1.0 / long_sum
    if short_sum < 0:
        weights[weights < 0] *= -1.0 / short_sum

    # Capping happens after the dollar-neutral rescale, not before: capping
    # first and then rescaling could push a name that was already at the
    # cap back over it.
    return weights.clip(lower=-max_position_weight, upper=max_position_weight)


def volatility_target_leverage(
    trailing_book_returns: pd.Series,
    vol_target: float,
    lookback_days: int,
    min_leverage: float,
    max_leverage: float,
) -> float:
    """Leverage multiplier that scales the whole book so trailing realized
    volatility tracks `vol_target` (annualized), using only returns already
    observed as of the rebalance date — fully causal, no look-ahead.
    Bounded so a brief lull can't imply extreme leverage and a brief spike
    can't force the book to nearly zero.
    """
    window = trailing_book_returns.tail(lookback_days).dropna()
    if len(window) < max(20, lookback_days // 3):
        return 1.0
    realized_vol = window.std() * np.sqrt(252)
    if realized_vol <= 0 or not np.isfinite(realized_vol):
        return 1.0
    leverage = vol_target / realized_vol
    return float(np.clip(leverage, min_leverage, max_leverage))


def market_impact_cost(
    delta_weights: pd.Series,
    avg_daily_dollar_volume: pd.Series,
    impact_coefficient: float,
    assumed_portfolio_dollars: float,
) -> float:
    """Square-root market impact cost for one rebalance's trades, as a
    fraction of total portfolio value. Cost scales with the square root of
    each trade's participation rate (trade dollars / that stock's own
    trailing average daily dollar volume) — the standard functional form
    in the market-impact literature (the same family as Almgren-Chriss):
    doubling participation more than doubles the price impact of the
    first share, but the cost per dollar traded rises slower than linear.
    """
    trade_dollars = delta_weights.abs() * assumed_portfolio_dollars
    volume_aligned = avg_daily_dollar_volume.reindex(delta_weights.index).replace(0, np.nan)
    participation_rate = (trade_dollars / volume_aligned).fillna(0.0)
    cost_fraction = impact_coefficient * np.sqrt(participation_rate)
    total_cost_dollars = (trade_dollars * cost_fraction).sum()
    return total_cost_dollars / assumed_portfolio_dollars
