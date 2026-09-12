"""The backtest engine: turns a composite score panel into a simulated
daily return series.

At each rebalance date it (1) selects and sizes positions from that date's
composite score, (2) scales the whole book's leverage to track a
volatility target using only already-realized returns, (3) charges a
market-impact cost on whatever changed since the last rebalance, and (4)
holds the resulting weights constant until the next rebalance date,
accumulating each stock's actual daily return in the meantime.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from quant.portfolio import market_impact_cost, size_positions, volatility_target_leverage


@dataclass
class BacktestResult:
    daily_returns: pd.Series                       # net of trading costs
    gross_daily_returns: pd.Series                  # before trading costs
    weights_history: dict[pd.Timestamp, pd.Series] = field(default_factory=dict)
    turnover_history: dict[pd.Timestamp, float] = field(default_factory=dict)
    leverage_history: dict[pd.Timestamp, float] = field(default_factory=dict)
    cost_history: dict[pd.Timestamp, float] = field(default_factory=dict)


def get_rebalance_dates(prices: pd.DataFrame, rebalance_freq: str) -> list[pd.Timestamp]:
    """Rebalance dates shared by the backtest engine and the IC analysis,
    so both operate on exactly the same dates."""
    candidates = prices.resample(rebalance_freq).last().index
    return [d for d in candidates if d in prices.index]


def run_backtest(
    prices: pd.DataFrame,
    dollar_volume: pd.DataFrame,
    composite_scores: pd.DataFrame,
    annualized_vol: pd.DataFrame,
    rebalance_freq: str,
    long_pct: float,
    short_pct: float,
    risk_aversion: float,
    signal_scale: float,
    covariance_lookback_days: int,
    covariance_shrinkage: float,
    max_position_weight: float,
    vol_target: float,
    vol_target_lookback_days: int,
    vol_target_min_leverage: float,
    vol_target_max_leverage: float,
    market_impact_coefficient: float,
    market_impact_lookback_days: int,
    assumed_portfolio_dollars: float,
) -> BacktestResult:
    stock_daily_returns = prices.pct_change()
    rebalance_dates = get_rebalance_dates(prices, rebalance_freq)

    net_returns = pd.Series(0.0, index=prices.index)
    gross_returns = pd.Series(0.0, index=prices.index)
    weights_history: dict[pd.Timestamp, pd.Series] = {}
    turnover_history: dict[pd.Timestamp, float] = {}
    leverage_history: dict[pd.Timestamp, float] = {}
    cost_history: dict[pd.Timestamp, float] = {}

    current_weights = pd.Series(0.0, index=prices.columns)
    trailing_book_returns = pd.Series(dtype=float)

    for i, rebal_date in enumerate(rebalance_dates):
        if rebal_date not in composite_scores.index or rebal_date not in annualized_vol.index:
            continue

        raw_weights = size_positions(
            scores=composite_scores.loc[rebal_date],
            annualized_vol=annualized_vol.loc[rebal_date],
            returns_history=stock_daily_returns.loc[:rebal_date],
            long_pct=long_pct,
            short_pct=short_pct,
            risk_aversion=risk_aversion,
            signal_scale=signal_scale,
            covariance_lookback_days=covariance_lookback_days,
            covariance_shrinkage=covariance_shrinkage,
            max_position_weight=max_position_weight,
        )

        leverage = volatility_target_leverage(
            trailing_book_returns=trailing_book_returns,
            vol_target=vol_target,
            lookback_days=vol_target_lookback_days,
            min_leverage=vol_target_min_leverage,
            max_leverage=vol_target_max_leverage,
        )
        new_weights = raw_weights * leverage

        avg_volume = dollar_volume.loc[:rebal_date].tail(market_impact_lookback_days).mean()
        delta_weights = new_weights - current_weights
        cost = market_impact_cost(
            delta_weights=delta_weights,
            avg_daily_dollar_volume=avg_volume,
            impact_coefficient=market_impact_coefficient,
            assumed_portfolio_dollars=assumed_portfolio_dollars,
        )
        turnover = delta_weights.abs().sum()

        weights_history[rebal_date] = new_weights
        turnover_history[rebal_date] = float(turnover)
        leverage_history[rebal_date] = leverage
        cost_history[rebal_date] = cost

        period_end = rebalance_dates[i + 1] if i + 1 < len(rebalance_dates) else prices.index[-1]
        holding_dates = prices.index[(prices.index > rebal_date) & (prices.index <= period_end)]

        if len(holding_dates) > 0:
            period_gross = stock_daily_returns.loc[holding_dates].mul(new_weights, axis=1).sum(axis=1)
            gross_returns.loc[holding_dates] = period_gross
            period_net = period_gross.copy()
            period_net.iloc[0] -= cost  # charge the trade's cost on the first day it's held
            net_returns.loc[holding_dates] = period_net
            trailing_book_returns = (
                period_net if trailing_book_returns.empty
                else pd.concat([trailing_book_returns, period_net])
            )

        current_weights = new_weights

    return BacktestResult(
        daily_returns=net_returns,
        gross_daily_returns=gross_returns,
        weights_history=weights_history,
        turnover_history=turnover_history,
        leverage_history=leverage_history,
        cost_history=cost_history,
    )
