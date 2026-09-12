# Long/Short Equity Factor Model

A four-factor, cross-sectional long/short equity strategy with a full
validation pipeline (Information Coefficient analysis, train/test split,
walk-forward analysis, statistical significance testing) and a web UI that
shows both a plain-language overview and the underlying math.

This is a fresh implementation built for the Wharton Investing Competition
project described in `project_overview.md` (the design doc from the prior
single-script version, `quant_long_short_model_4.py`, referenced only for
its methodology, not its code). The goal restated: a genuinely validated,
modest positive Sharpe ratio, defended with real statistical rigor, rather
than a large backtested number that can't survive scrutiny.

## Important note on data: synthetic vs. real

**This development environment's outbound network access is blocked from
reaching Yahoo Finance** (an organization egress policy, confirmed via a
403 on `query1.finance.yahoo.com`). So the model ships with two data
providers behind one interface (`quant/data.py`):

- `synthetic` (the default): a statistically generated multi-year price
  panel — market regime-switching, sector factors, a persistent momentum-
  like drift, short-term reversal microstructure, and a real (but modest
  and noisy) illiquidity premium — built so the full validation pipeline
  has a genuine, quantifiable signal to find, at roughly the same
  Information Coefficient magnitude (0.02–0.05) the reference project
  found on real data. **It is not real market data and the specific
  Sharpe ratios it produces are not a claim about real markets** — see
  "What the synthetic default actually shows" below.
- `yfinance`: real downloaded prices, for anyone running this on a machine
  with normal internet access. Every module downstream of `quant.data`
  (factors, portfolio construction, the backtest, validation) is written
  against the same `(dates x tickers)` DataFrame shape regardless of
  source, so switching is a one-line config change
  (`ModelConfig(data_source="yfinance")`), not a rewrite. Point it at a
  real S&P 500 snapshot (`quant/universe.py` ships a ~94-name universe
  across all 11 GICS sectors; extend `TICKERS`/`SECTOR_MAP` for the full
  500) and it will produce the reference project's kind of real,
  sobering, hard-won result — including the possibility that a factor
  looks real in-sample and falls apart out-of-sample, which is the whole
  point of the validation pipeline.

## Architecture

```
quant/
  config.py       ModelConfig — every tunable parameter, one place
  universe.py     Ticker list + GICS sector map
  data.py         Synthetic + yfinance price/volume providers, with caching
  factors.py      Momentum, reversal, low-vol, illiquidity + z-scoring/sector-neutralizing
  portfolio.py    Composite scoring, tangency-portfolio sizing, vol targeting, trading costs
  backtest.py     The engine: rebalance -> size -> hold -> accumulate returns
  validation.py   Information Coefficient, Sharpe + significance, train/test, walk-forward
  pipeline.py     Wires all of the above into one reproducible run -> JSON

scripts/
  run_model.py    CLI: run the model, print a report, save results.json + equity_curve.png

webapp/
  server.py         FastAPI backend (two endpoints: config schema, run)
  config_schema.py  Plain-language + math descriptions of every tunable parameter
  static/           Vanilla HTML/CSS/JS frontend (Chart.js vendored, no build step)

tests/              pytest unit tests for factors, portfolio sizing, validation, data/backtest
```

### The model, in one paragraph

At each monthly rebalance, every stock gets a z-score for four factors —
momentum (12-month return, skipping the most recent month), short-term
reversal (negative 1-week return), low volatility (negative realized
volatility), and Amihud illiquidity (`mean(|return| / dollar volume)`) —
combined into a weighted composite score, optionally demeaned within GICS
sector. The top/bottom slices become the long/short books. Position sizing
generalizes the single-asset Merton fraction `w = (mu - r) / (gamma *
sigma^2)` to the tangency portfolio `w = (1/gamma) * Sigma^-1 * (mu - r)`,
using a shrinkage-stabilized covariance matrix, so correlated names are
sized down relative to independent ones. The whole book's leverage is
scaled each rebalance to track a volatility target using only
already-realized returns (fully causal), and every trade is charged a
square-root market-impact cost based on its size relative to that stock's
own trailing average dollar volume.

### The validation layers, and why each exists

- **Information Coefficient (IC)**: is a factor's *ranking* predictive of
  *forward returns*, independent of how a portfolio is built on top of it?
  Computed strictly on in-sample rebalance dates — `quant/pipeline.py` is
  the one place that enforces this boundary structurally, so it can't
  leak by accident.
- **Train/test split**: performance reported separately for in-sample and
  out-of-sample periods, so overfitting shows up as a visible gap instead
  of hiding in one blended number.
- **Walk-forward analysis**: the full backtest cut into consecutive
  windows, reported as pooled / in-sample-only / out-of-sample-only
  aggregates — a strong early stretch can inflate a pooled number in a way
  that looks like more evidence than it is.
- **Statistical significance**: every Sharpe ratio comes with an
  approximate standard error and t-stat (the standard i.i.d.-returns
  approximation; it ignores serial correlation, so treat it as
  directional, not a precise p-value), with an explicit
  "not statistically significant" flag when a result can't be
  distinguished from zero.

## What the synthetic default actually shows

Running the default config (`python scripts/run_model.py`) on synthetic
data produces something close to the reference project's own findings:

```
Information Coefficient (in-sample rebalance dates only)
factor         mean IC    IC IR   % positive
momentum        0.024     0.24      56%
reversal        0.014     0.12      52%
low_vol        -0.013    -0.10      48%
illiquidity     0.028     0.27      60%

Full Period   Sharpe 0.57 (t=1.54, NOT significant)
In Sample     Sharpe 0.81 (t=1.85, NOT significant)
Out of Sample Sharpe -0.03 (t=-0.04, NOT significant)

Walk-forward out-of-sample windows: mean Sharpe 0.04, 50% positive, n=4
```

Momentum and illiquidity carry a real (same-signed) IC; low volatility's
IC is real in magnitude but points the wrong way for how it's
conventionally used — the default config's weights (momentum 0.35,
illiquidity 0.65, reversal and low-vol both 0) reflect that evidence, not
an arbitrary choice (see the comment above `ModelConfig`'s factor weight
fields). And, honestly: with only 4 independent out-of-sample windows, the
out-of-sample Sharpe is not statistically distinguishable from zero. That
is not a bug to fix by re-tuning until it looks better — re-tuning against
the out-of-sample number is exactly the leak this pipeline exists to
prevent. It's the same honest, inconclusive-but-directionally-real place
the original research landed, reproduced here structurally rather than
by copying a result.

## Running it

```bash
pip install -r requirements.txt

# CLI: prints a full report, writes results/results.json + results/equity_curve.png
python scripts/run_model.py

# Try different factor weights, a different seed, or (with real internet access) real data:
python scripts/run_model.py --illiquidity-weight 1.0 --momentum-weight 0
python scripts/run_model.py --seed 3
python scripts/run_model.py --data-source yfinance

# Web UI: plain-language "Overview" tab + full-math "Math & Diagnostics" tab
uvicorn webapp.server:app --reload
# then open http://127.0.0.1:8000

# Tests
pytest
```

## Known limitations (same honesty standard as the original doc)

- **Synthetic data's Sharpe magnitude is a demo artifact, not a market
  claim.** The synthetic generator is tuned so its IC lands in the same
  0.02–0.05 range the reference project measured on real data, but a
  single ~94-stock, one-path Monte Carlo draw is much noisier than a real
  ~500-stock multi-decade dataset — different `--seed` values swing the
  full-period Sharpe from clearly negative to clearly positive purely from
  sampling noise (see the seed sweep discussion in code review history).
  Run several seeds, not just the default, before drawing any conclusion
  from the synthetic path — and prefer real `yfinance` data entirely for
  anything beyond exercising the pipeline.
- **Only 4 independent out-of-sample walk-forward windows** even in the
  7-year default range — nowhere near enough to be confident either way,
  by design of a `2018-2024` backtest with a `2022-12-31` train/test split
  and 6-month windows. Extending the date range or shortening the window
  gets more windows at the cost of each one being noisier.
- **No fundamental or alternative data.** Only price and volume are used,
  matching the free-data-source constraint of the original project.
- **No automatic re-tuning across walk-forward windows.** Factor weights
  are set once from in-sample IC evidence and held fixed, on purpose — an
  automatic re-tuning loop is a subtler, harder-to-reason-about form of
  the same overfitting this pipeline is built to catch.
- **`assumed_portfolio_dollars`** (used only to convert a fractional
  weight change into a dollar trade size for the cost model) is a modeling
  assumption, not a measured or competition-mandated figure.
