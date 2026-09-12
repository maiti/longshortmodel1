"""Every tunable parameter of the model in one place.

The rest of the codebase should treat a ``ModelConfig`` as the single
source of truth: no module reaches past it for a hardcoded lookback window,
threshold, or weight. That is what makes a run reproducible from its config
alone, and what lets the web UI expose "what happens if I change X" without
touching model code.
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields
from typing import Any, Literal

import numpy as np

DataSource = Literal["synthetic", "yfinance"]


@dataclass
class ModelConfig:
    # -- Universe & date range -------------------------------------------------
    tickers: list[str] = field(default_factory=list)
    start_date: str = "2018-01-01"
    end_date: str = "2024-12-31"
    data_source: DataSource = "synthetic"
    random_seed: int = 9  # only used by the synthetic data provider

    # -- Factor lookback windows, in trading days -------------------------------
    momentum_lookback_days: int = 252
    momentum_skip_days: int = 21
    reversal_lookback_days: int = 5
    volatility_lookback_days: int = 60
    illiquidity_lookback_days: int = 60

    # -- Factor weights (must sum to 1.0) ---------------------------------------
    # These defaults are evidence-based, not arbitrary: running
    # quant.validation.information_coefficient on in-sample rebalance dates
    # only (see quant/pipeline.py) shows momentum and illiquidity with a
    # real, same-signed Information Coefficient on this universe and
    # period, short-term reversal indistinguishable from noise, and low
    # volatility with a real signal magnitude pointing the WRONG direction
    # for how it's conventionally used (deliberately not "fixed" by
    # flipping its sign — see README). Re-run the IC analysis and update
    # these weights yourself before trusting them on a different universe,
    # date range, or (especially) real yfinance data: this is a
    # measurement on one specific sample, not a fixed truth about these
    # four factors.
    momentum_weight: float = 0.35
    reversal_weight: float = 0.0
    volatility_weight: float = 0.0
    illiquidity_weight: float = 0.65

    # -- Stock selection ----------------------------------------------------
    rebalance_freq: str = "ME"   # pandas offset alias; "ME" = month end
    long_pct: float = 0.20
    short_pct: float = 0.20

    # -- Position sizing (tangency / generalized Merton) -------------------
    risk_aversion: float = 5.0
    signal_scale: float = 0.05
    covariance_lookback_days: int = 120
    covariance_shrinkage: float = 0.4
    max_position_weight: float = 0.10

    # -- Risk overlays --------------------------------------------------------
    sector_neutral_scoring: bool = True
    vol_target: float = 0.10
    vol_target_lookback_days: int = 60
    vol_target_min_leverage: float = 0.5
    vol_target_max_leverage: float = 2.0

    # -- Trading costs --------------------------------------------------------
    market_impact_coefficient: float = 0.1
    market_impact_lookback_days: int = 20
    assumed_portfolio_dollars: float = 10_000_000.0

    # -- Validation -----------------------------------------------------------
    train_end_date: str = "2022-12-31"
    walk_forward_window_months: int = 6

    def __post_init__(self) -> None:
        total_weight = (
            self.momentum_weight
            + self.reversal_weight
            + self.volatility_weight
            + self.illiquidity_weight
        )
        if not np.isclose(total_weight, 1.0):
            raise ValueError(f"Factor weights must sum to 1.0, got {total_weight:.4f}")
        if not (0 < self.long_pct <= 0.5) or not (0 < self.short_pct <= 0.5):
            raise ValueError("long_pct and short_pct must be in (0, 0.5]")
        if self.start_date >= self.end_date:
            raise ValueError("start_date must be before end_date")
        if not (self.start_date <= self.train_end_date < self.end_date):
            raise ValueError("train_end_date must fall strictly between start_date and end_date")
        if not (0.0 <= self.covariance_shrinkage <= 1.0):
            raise ValueError("covariance_shrinkage must be between 0 and 1")

    @classmethod
    def from_dict(cls, overrides: dict[str, Any]) -> "ModelConfig":
        """Build a config from a plain dict, ignoring unknown keys, so the
        web API can accept a JSON body without hand maintaining a matching
        Pydantic model field for field.
        """
        known = {f.name for f in fields(cls)}
        clean = {k: v for k, v in overrides.items() if k in known and v is not None}
        return cls(**clean)

    def to_dict(self) -> dict[str, Any]:
        return {f.name: getattr(self, f.name) for f in fields(self)}
