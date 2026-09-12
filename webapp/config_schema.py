"""Plain-language + technical descriptions of every parameter the web UI
lets a user tune. Kept separate from `quant.config.ModelConfig` on purpose:
the model doesn't need to know it's being described to a human, and this
file can be as verbose as it wants without cluttering the model code.

Each field carries two descriptions: `simple` (for someone who has never
touched a trading model before) and `math` (the actual formula or
statistical definition, for the Math view).
"""

from __future__ import annotations

CONFIG_SCHEMA: list[dict] = [
    {
        "id": "data",
        "title": "Data",
        "fields": [
            {
                "key": "data_source",
                "label": "Data source",
                "type": "select",
                "options": ["synthetic", "yfinance"],
                "simple": "Where the stock prices come from. 'synthetic' generates a "
                          "realistic but computer-simulated market so this demo works "
                          "without needing a live internet connection to a stock data "
                          "provider. 'yfinance' downloads real historical prices from "
                          "Yahoo Finance (only works on a machine with normal internet "
                          "access to it).",
                "math": "PriceData provider: either a statistically-generated panel "
                        "(quant.data.generate_synthetic_market) or a real download "
                        "(quant.data.fetch_yfinance_data).",
            },
            {
                "key": "start_date", "label": "Backtest start date", "type": "date",
                "simple": "The first day of history the model looks at.",
                "math": "Lower bound of the (dates x tickers) price panel.",
            },
            {
                "key": "end_date", "label": "Backtest end date", "type": "date",
                "simple": "The last day of history the model looks at.",
                "math": "Upper bound of the (dates x tickers) price panel.",
            },
            {
                "key": "train_end_date", "label": "Train / test split date", "type": "date",
                "simple": "Everything up to this date is the 'in sample' period, where "
                          "it's fair to look at results while tuning the model. "
                          "Everything after is 'out of sample': a look at how the model "
                          "would have done on data it effectively hadn't seen yet. This "
                          "is how the model checks itself for overfitting.",
                "math": "Boundary date for quant.validation.train_test_split_summary "
                        "and for labeling walk-forward windows in/out of sample.",
            },
        ],
    },
    {
        "id": "factors",
        "title": "Factor weights",
        "fields": [
            {
                "key": "momentum_weight", "label": "Momentum weight", "type": "float", "min": 0, "max": 1, "step": 0.05,
                "simple": "How much the model favors stocks that have been rising "
                          "steadily over the past year (skipping the most recent month).",
                "math": "Weight on the cross-sectionally standardized 12-month return "
                        "(lagged by momentum_skip_days) in the composite score.",
            },
            {
                "key": "reversal_weight", "label": "Short-term reversal weight", "type": "float", "min": 0, "max": 1, "step": 0.05,
                "simple": "How much the model favors stocks that just dropped over the "
                          "last week, on the theory that sharp short-term moves partly "
                          "bounce back.",
                "math": "Weight on the negative of the trailing 1-week return.",
            },
            {
                "key": "volatility_weight", "label": "Low volatility weight", "type": "float", "min": 0, "max": 1, "step": 0.05,
                "simple": "How much the model favors calmer, less jumpy stocks. Default "
                          "is 0 here because this sample's evidence shows this factor "
                          "points the wrong way (see the Math view's Information "
                          "Coefficient table) -- turning it up would knowingly bet "
                          "against the evidence.",
                "math": "Weight on the negative of trailing realized volatility.",
            },
            {
                "key": "illiquidity_weight", "label": "Illiquidity weight", "type": "float", "min": 0, "max": 1, "step": 0.05,
                "simple": "How much the model favors harder-to-trade stocks, which "
                          "historically get paid a bit more as compensation for that "
                          "difficulty (the 'illiquidity premium').",
                "math": "Weight on the Amihud illiquidity measure: mean(|daily return| "
                        "/ dollar volume) over the lookback window.",
            },
        ],
    },
    {
        "id": "selection",
        "title": "Stock selection & sizing",
        "fields": [
            {
                "key": "long_pct", "label": "Long bucket size", "type": "float", "min": 0.05, "max": 0.5, "step": 0.05,
                "simple": "What fraction of the highest-scoring stocks to buy (go long).",
                "math": "Top long_pct of ranked composite scores become the long book.",
            },
            {
                "key": "short_pct", "label": "Short bucket size", "type": "float", "min": 0.05, "max": 0.5, "step": 0.05,
                "simple": "What fraction of the lowest-scoring stocks to bet against (go short).",
                "math": "Bottom short_pct of ranked composite scores become the short book.",
            },
            {
                "key": "risk_aversion", "label": "Risk aversion (gamma)", "type": "float", "min": 1, "max": 20, "step": 0.5,
                "simple": "How cautious the model is when sizing bets. Higher = smaller, "
                          "more even-sized positions; lower = more concentrated bets on "
                          "the stocks with the best score relative to their risk.",
                "math": "gamma in the tangency-portfolio rule w = (1/gamma) * "
                        "Sigma^-1 * (mu - r), the multivariate generalization of the "
                        "Merton fraction w = (mu - r) / (gamma * sigma^2).",
            },
            {
                "key": "covariance_shrinkage", "label": "Covariance shrinkage", "type": "float", "min": 0, "max": 1, "step": 0.05,
                "simple": "How much the model distrusts the raw, noisy correlations it "
                          "measures between stocks. 0 = trust them fully; 1 = ignore "
                          "correlation entirely and size each stock only by its own risk.",
                "math": "Blend factor between the sample covariance matrix and its own "
                        "diagonal: Sigma_shrunk = (1-s)*Sigma_sample + s*diag(Sigma_sample).",
            },
            {
                "key": "max_position_weight", "label": "Max position size", "type": "float", "min": 0.02, "max": 0.5, "step": 0.02,
                "simple": "The largest any single stock is allowed to be, as a fraction "
                          "of the whole long or short book, no matter how good its score.",
                "math": "Per-name weight cap applied after the dollar-neutral rescale.",
            },
            {
                "key": "sector_neutral_scoring", "label": "Sector-neutral scoring", "type": "bool",
                "simple": "When on, stocks are ranked against others in their own "
                          "industry sector, not the whole market -- this stops the "
                          "model from secretly making one big bet like 'long all tech, "
                          "short all utilities'.",
                "math": "Demeans the composite score within each GICS sector before "
                        "position sizing.",
            },
        ],
    },
    {
        "id": "risk",
        "title": "Risk & costs",
        "fields": [
            {
                "key": "vol_target", "label": "Volatility target (annualized)", "type": "float", "min": 0.02, "max": 0.30, "step": 0.01,
                "simple": "How much the whole portfolio's ups and downs should target "
                          "on average, per year. 0.10 means the model tries to keep "
                          "swings around 10% a year -- it automatically dials leverage "
                          "up or down to stay near this.",
                "math": "Target annualized standard deviation the leverage multiplier "
                        "solves for, using only already-realized (causal) returns.",
            },
            {
                "key": "market_impact_coefficient", "label": "Trading cost coefficient", "type": "float", "min": 0, "max": 0.5, "step": 0.01,
                "simple": "How expensive it is assumed to be to trade a large position "
                          "in a thinly-traded stock. Higher means the model gets "
                          "penalized more for churning its holdings.",
                "math": "Coefficient in the square-root market impact cost model: "
                        "cost_fraction = coefficient * sqrt(trade_dollars / avg_daily_dollar_volume).",
            },
            {
                "key": "walk_forward_window_months", "label": "Walk-forward window (months)", "type": "int", "min": 3, "max": 12, "step": 1,
                "simple": "How long each 'slice' of the backtest is when checking "
                          "performance window by window, instead of trusting one big "
                          "combined number.",
                "math": "Window length for quant.validation.walk_forward_analysis.",
            },
        ],
    },
]
