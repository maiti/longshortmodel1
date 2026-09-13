"""Everything that answers "is this actually working," kept separate from
the trading logic itself so none of it can quietly influence the strategy.

Four layers, matching what a quant desk would actually ask before trusting
a backtest:

    information_coefficient  Does each factor's ranking predict forward
                              returns at all, independent of portfolio
                              construction? Must only ever be computed on
                              in-sample rebalance dates — the pipeline
                              enforces this by only passing it those dates.
    performance_summary       Sharpe ratio with an approximate standard
                              error and t-stat, so "Sharpe 0.6" comes with
                              an honest answer to "or is that just noise?"
    train_test_split          The same performance summary, reported
                              separately for the in-sample and out-of-sample
                              periods, so overfitting shows up as a visible
                              gap rather than staying hidden in one number.
    walk_forward_analysis      The full backtest cut into consecutive
                              windows, reported as a distribution (pooled,
                              in-sample-only, out-of-sample-only) instead of
                              one point estimate — a strategy that only
                              worked in one early stretch shows up here
                              even if its full-period Sharpe looks fine.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Information Coefficient
# ---------------------------------------------------------------------------

def information_coefficient(
    factor_scores: dict[str, pd.DataFrame],
    prices: pd.DataFrame,
    rebalance_dates: list[pd.Timestamp],
) -> pd.DataFrame:
    """For each factor, the Spearman rank correlation between that date's
    score and the stock's forward return to the next rebalance date,
    averaged across dates.

    IMPORTANT: pass only in-sample rebalance dates here. Computing this on
    dates that include the out-of-sample period, before committing to
    factor weights, means the weight choice has already seen the data it
    is later "tested" against — this is the single most common way a
    backtest's validation step secretly invalidates itself. See
    quant.pipeline for where this boundary is enforced.

    Returns a DataFrame indexed by factor name with columns:
        mean_ic, ic_std, ic_ir (mean/std, an information-ratio-style
        signal-to-noise measure), pct_positive, n_periods.

    Rule of thumb from the published factor-investing literature: a mean
    IC above roughly 0.02-0.05 with a fairly consistent sign is considered
    a real, usable signal at the individual-factor level. Anything near
    zero, or flipping sign across periods, is not distinguishable from
    noise regardless of how it's used downstream.
    """
    results = {}

    for factor_name, score_df in factor_scores.items():
        ic_values = []
        for i in range(len(rebalance_dates) - 1):
            date, next_date = rebalance_dates[i], rebalance_dates[i + 1]
            if date not in score_df.index or date not in prices.index:
                continue
            scores_at_date = score_df.loc[date].dropna()
            forward_return = prices.loc[next_date, scores_at_date.index] / prices.loc[date, scores_at_date.index] - 1
            aligned = pd.concat([scores_at_date, forward_return], axis=1).dropna()
            aligned.columns = ["score", "forward_return"]
            if len(aligned) < 10:
                continue
            # Spearman's rank correlation is, by definition, the Pearson
            # correlation of the two variables' ranks. Computing it this
            # way (rather than pandas' .corr(method="spearman")) avoids a
            # hard runtime dependency on scipy, which pandas imports
            # internally only for the spearman/kendall methods -- scipy
            # bundles a ~140MB compiled BLAS/LAPACK payload that is a poor
            # trade for one rank correlation, especially in a deployment
            # with a bundle size budget (see README).
            ic = aligned["score"].rank().corr(aligned["forward_return"].rank())
            if not np.isnan(ic):
                ic_values.append(ic)

        ic_series = pd.Series(ic_values, dtype=float)
        results[factor_name] = {
            "mean_ic": ic_series.mean(),
            "ic_std": ic_series.std(),
            "ic_ir": ic_series.mean() / ic_series.std() if ic_series.std() > 0 else np.nan,
            "pct_positive": (ic_series > 0).mean() if len(ic_series) else np.nan,
            "n_periods": len(ic_series),
        }
    return pd.DataFrame(results).T


# ---------------------------------------------------------------------------
# Sharpe ratio with significance
# ---------------------------------------------------------------------------

def max_drawdown(daily_returns: pd.Series) -> float:
    equity = (1 + daily_returns.fillna(0)).cumprod()
    running_max = equity.cummax()
    drawdown = equity / running_max - 1
    return float(drawdown.min()) if len(drawdown) else 0.0


def performance_summary(daily_returns: pd.Series, label: str = "") -> dict:
    """Annualized return, volatility, Sharpe ratio, max drawdown, and an
    approximate standard error / t-stat for the Sharpe ratio.

    The standard error uses the standard i.i.d.-returns approximation
    SE(Sharpe) ~= sqrt((1 + 0.5 * SR^2) / N) (per-period SR and N; the
    annualizing sqrt(252) factor cancels out of the resulting t-stat).
    This ignores serial correlation in returns, which a monthly-rebalanced
    strategy can have some of; treat the t-stat as a directionally useful
    approximation, not a precise p-value.
    """
    clean = daily_returns.dropna()
    n = len(clean)
    if n < 2 or clean.std() == 0:
        return {
            "label": label, "n_days": n, "annualized_return": 0.0, "annualized_vol": 0.0,
            "sharpe": 0.0, "sharpe_se": np.nan, "t_stat": np.nan, "max_drawdown": 0.0,
            "significant_at_95": False,
        }

    daily_mean, daily_std = clean.mean(), clean.std()
    daily_sharpe = daily_mean / daily_std
    annualized_sharpe = daily_sharpe * np.sqrt(252)
    annualized_return = (1 + daily_mean) ** 252 - 1
    annualized_vol = daily_std * np.sqrt(252)

    se_daily_sharpe = np.sqrt((1 + 0.5 * daily_sharpe**2) / n)
    t_stat = daily_sharpe / se_daily_sharpe if se_daily_sharpe > 0 else np.nan
    sharpe_se = se_daily_sharpe * np.sqrt(252)

    return {
        "label": label,
        "n_days": n,
        "annualized_return": float(annualized_return),
        "annualized_vol": float(annualized_vol),
        "sharpe": float(annualized_sharpe),
        "sharpe_se": float(sharpe_se),
        "t_stat": float(t_stat),
        "max_drawdown": max_drawdown(clean),
        "significant_at_95": bool(abs(t_stat) > 1.96) if np.isfinite(t_stat) else False,
    }


def train_test_split_summary(daily_returns: pd.Series, train_end_date: str) -> dict:
    train_end = pd.Timestamp(train_end_date)
    in_sample = daily_returns.loc[:train_end]
    out_of_sample = daily_returns.loc[train_end:].iloc[1:]  # exclude the split date itself from OOS
    return {
        "full_period": performance_summary(daily_returns, "Full Period"),
        "in_sample": performance_summary(in_sample, "In Sample"),
        "out_of_sample": performance_summary(out_of_sample, "Out of Sample"),
    }


# ---------------------------------------------------------------------------
# Walk-forward analysis
# ---------------------------------------------------------------------------

def walk_forward_windows(daily_returns: pd.Series, window_months: int) -> list[dict]:
    """Split the return series into consecutive calendar windows and
    compute a performance summary for each one independently.
    """
    if daily_returns.empty:
        return []
    start = daily_returns.index.min()
    end = daily_returns.index.max()
    windows = []
    window_start = start
    while window_start <= end:
        window_end = window_start + pd.DateOffset(months=window_months) - pd.Timedelta(days=1)
        window_returns = daily_returns.loc[window_start:window_end]
        if len(window_returns) > 5:
            summary = performance_summary(window_returns)
            summary["window_start"] = window_start.strftime("%Y-%m-%d")
            summary["window_end"] = min(window_end, end).strftime("%Y-%m-%d")
            windows.append(summary)
        window_start = window_end + pd.Timedelta(days=1)
    return windows


def _aggregate_windows(windows: list[dict]) -> dict:
    if not windows:
        return {"mean_sharpe": np.nan, "pct_positive": np.nan, "n_windows": 0}
    sharpes = np.array([w["sharpe"] for w in windows])
    return {
        "mean_sharpe": float(sharpes.mean()),
        "pct_positive": float((sharpes > 0).mean()),
        "n_windows": len(windows),
    }


def walk_forward_analysis(daily_returns: pd.Series, window_months: int, train_end_date: str) -> dict:
    """Windows plus three aggregate views: pooled (all windows), in-sample
    only, and out-of-sample only. The out-of-sample-only aggregate is the
    one that actually answers whether the strategy has a real edge; the
    pooled number is reported for context but a strong early stretch can
    inflate it in a way that looks, at a glance, like more evidence than
    it really is.
    """
    train_end = pd.Timestamp(train_end_date)
    windows = walk_forward_windows(daily_returns, window_months)
    for w in windows:
        w["in_sample"] = pd.Timestamp(w["window_end"]) <= train_end

    in_sample_windows = [w for w in windows if w["in_sample"]]
    out_of_sample_windows = [w for w in windows if not w["in_sample"]]

    return {
        "windows": windows,
        "pooled": _aggregate_windows(windows),
        "in_sample": _aggregate_windows(in_sample_windows),
        "out_of_sample": _aggregate_windows(out_of_sample_windows),
    }
