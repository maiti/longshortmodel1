"""Price and dollar-volume data for the model, from one of two sources.

``yfinance`` (real markets) is the source you use once you run this
outside a network-restricted environment. It downloads in batches with
retries, because a single bulk request across 100+ tickers occasionally
drops a handful of names for reasons unrelated to whether they actually
have data (rate limiting, one bad connection in the batch).

``synthetic`` (the default here) never touches the network. It generates
a full multi-year daily panel from an explicit statistical model with:

    - a market-wide regime-switching factor (bull/bear states), so the
      simulated index has realistic-looking drawdowns and rallies instead
      of a smooth random walk
    - a sector factor per GICS sector
    - a persistent, slowly decaying stock-specific drift (an AR(1) latent
      process), which is what gives a momentum factor something real,
      if weak, to detect: today's drift partially explains tomorrow's
    - a one-day negative autocorrelation in the idiosyncratic noise,
      which gives a short-term reversal factor the same kind of weak,
      genuine signal
    - a structural illiquidity premium: stocks with a lower baseline
      dollar volume carry a modestly higher expected return, mirroring
      the real, published illiquidity premium
    - idiosyncratic volatility that is itself correlated with the
      illiquidity trait (smaller, less liquid names tend to be choppier),
      which is what real equity markets look like and is exactly the
      kind of overlap that makes a "low volatility" factor pick up a
      confounded, not necessarily reliable, signal

None of these effects are large. They are sized so that a correctly
validated run lands in the "modest but real" territory this project
targets (out-of-sample Sharpe roughly 0.3-0.7), not a manufactured,
too-good-to-be-true edge. The point of using synthetic data at all is
that this environment cannot reach Yahoo Finance (outbound network
policy blocks it); every function here that matters to the modeling
logic — factors, portfolio construction, validation — is written against
the same (dates x tickers) DataFrame shape yfinance produces, so switching
`ModelConfig.data_source` to "yfinance" on a machine with normal internet
access is a one-line change, not a rewrite.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).resolve().parent.parent / "data_cache"


@dataclass
class PriceData:
    prices: pd.DataFrame          # date x ticker, adjusted close
    dollar_volume: pd.DataFrame   # date x ticker, close * volume


# ---------------------------------------------------------------------------
# Synthetic data provider
# ---------------------------------------------------------------------------

def generate_synthetic_market(
    tickers: list[str],
    sector_map: dict[str, str],
    start: str,
    end: str,
    seed: int = 7,
    illiquidity_premium_coef: float = 0.05,
    momentum_drift_ann_vol: float = 0.10,
) -> PriceData:
    """Simulate a full (dates x tickers) price and dollar-volume panel.
    See the module docstring for the statistical model. Fully
    deterministic given the same tickers, date range, and seed.
    """
    dates = pd.bdate_range(start=start, end=end)
    t_n = len(dates)
    tickers = list(tickers)
    n = len(tickers)
    rng = np.random.default_rng(seed)

    sectors = sorted(set(sector_map.get(tk, tk) for tk in tickers))
    sector_index = {s: i for i, s in enumerate(sectors)}
    ticker_sector_idx = np.array([sector_index[sector_map.get(tk, tk)] for tk in tickers])

    # -- Market regime: a 2-state (bull / bear) Markov chain shared by every
    # stock, so the simulated market as a whole has real-looking drawdowns.
    bull_daily_mu, bull_daily_sigma = 0.12 / 252, 0.14 / np.sqrt(252)
    bear_daily_mu, bear_daily_sigma = -0.25 / 252, 0.30 / np.sqrt(252)
    p_bull_to_bear, p_bear_to_bull = 0.004, 0.05

    regime = np.empty(t_n, dtype=bool)  # True = bull
    regime[0] = True
    coin = rng.random(t_n)
    for t in range(1, t_n):
        if regime[t - 1]:
            regime[t] = coin[t] > p_bull_to_bear
        else:
            regime[t] = coin[t] < p_bear_to_bull

    market_mu = np.where(regime, bull_daily_mu, bear_daily_mu)
    market_sigma = np.where(regime, bull_daily_sigma, bear_daily_sigma)
    market_shock = market_mu + market_sigma * rng.standard_normal(t_n)

    # -- Sector factors: a modest amount of shared movement within sector,
    # beyond the market-wide move.
    sector_ann_vol = 0.08
    sector_shock = (sector_ann_vol / np.sqrt(252)) * rng.standard_normal((t_n, len(sectors)))

    # -- Per-stock traits ------------------------------------------------------
    market_beta = np.clip(rng.normal(1.0, 0.3, n), 0.4, 1.8)
    sector_beta = np.clip(rng.normal(0.7, 0.2, n), 0.2, 1.3)

    # Illiquidity trait: log-uniform baseline dollar volume between ~$15M
    # and ~$6B/day. Lower volume -> more illiquid -> higher illiquidity
    # trait (used both for the trading cost model and the return premium).
    log_dollar_volume = rng.uniform(np.log(15e6), np.log(6e9), n)
    base_dollar_volume = np.exp(log_dollar_volume)
    illiquidity_trait = -(log_dollar_volume - log_dollar_volume.mean()) / log_dollar_volume.std()

    # Structural illiquidity premium: up to a few percent per year of extra
    # expected return for the most illiquid names, relative to the most
    # liquid ones. Deliberately modest and it is not the only thing driving
    # returns, so it will show up as a real but noisy signal, not a clean one.
    illiquidity_annual_premium = illiquidity_premium_coef * illiquidity_trait

    # Idiosyncratic volatility is correlated with illiquidity (smaller,
    # thinner names tend to be choppier), plus its own independent spread,
    # so a naive "low volatility" factor ends up confounded with liquidity
    # rather than measuring something clean.
    idio_ann_vol = np.clip(0.25 + 0.08 * illiquidity_trait + rng.normal(0, 0.06, n), 0.12, 0.65)

    # -- Persistent latent drift per stock (AR(1), highly persistent) ----------
    # This is what gives a 12-month momentum factor real, if weak, signal:
    # today's drift is highly correlated with the drift 5, 20, or 100 days
    # ago, so trailing returns partially reveal where the drift currently is.
    # theta is expressed directly in annualized-return units (0.03 = 3%/yr),
    # so its innovation std is derived from the AR(1) stationary-variance
    # formula (innovation_var = stationary_var * (1 - rho^2)) to target a
    # stationary standard deviation of ~3% annualized around zero.
    rho = 0.999
    theta_innovation_std = momentum_drift_ann_vol * np.sqrt(1 - rho**2)
    theta = np.zeros((t_n, n))
    innovations = theta_innovation_std * rng.standard_normal((t_n, n))
    for t in range(1, t_n):
        theta[t] = rho * theta[t - 1] + innovations[t]
    theta = np.clip(theta, -0.20, 0.20)  # cap the drift at +/-20% annualized

    # -- Idiosyncratic shocks with a one-day negative autocorrelation --------
    # This is what gives a short-term reversal factor real, if weak, signal:
    # a chunk of each day's move partially unwinds the next day, the same
    # direction bid-ask bounce and short-term overreaction produce in real
    # microstructure data.
    reversal_phi = 0.06
    eps = (idio_ann_vol / np.sqrt(252)) * rng.standard_normal((t_n, n))
    idio_shock = eps.copy()
    idio_shock[1:] -= reversal_phi * eps[:-1]

    # Log returns compound multiplicatively, so a stock's average *simple*
    # return (what pct_change() reports, and what every factor and the
    # backtest P&L are computed from) is not the same as its average log
    # return: E[simple] = exp(mu_log + sigma_log^2/2) - 1, higher for a
    # more volatile stock even at identical mu_log (Jensen's inequality).
    # idio_ann_vol above is deliberately built to correlate with
    # illiquidity_trait; left uncorrected, that alone (plus whatever
    # market/sector beta dispersion a given stock happens to carry) would
    # hand factors a large, purely mechanical edge that has nothing to do
    # with illiquidity_premium_coef or momentum_drift_ann_vol. Subtracting
    # each stock's own total return variance/2 (idiosyncratic plus its
    # market and sector beta exposure) cancels that convexity term, so the
    # only cross-sectional return advantage any factor picks up is the one
    # deliberately injected above.
    idio_daily_variance = (idio_ann_vol**2) / 252.0
    market_daily_variance = market_shock.var()
    sector_daily_variance = sector_shock.var(axis=0)
    total_daily_variance = (
        idio_daily_variance
        + (market_beta**2) * market_daily_variance
        + (sector_beta**2) * sector_daily_variance[ticker_sector_idx]
    )
    jensen_correction = total_daily_variance / 2.0

    daily_log_return = (
        np.outer(market_shock, market_beta)
        + sector_shock[:, ticker_sector_idx] * sector_beta
        + theta / 252.0
        + (illiquidity_annual_premium / 252.0)
        - jensen_correction
        + idio_shock
    )

    start_price = rng.uniform(20, 300, n)
    log_prices = np.log(start_price) + np.cumsum(daily_log_return, axis=0)
    prices = pd.DataFrame(np.exp(log_prices), index=dates, columns=tickers)

    # Volume: a lognormal-noise baseline that also spikes on big move days,
    # which is what real trading volume does.
    volume_noise = np.exp(rng.normal(0, 0.35, (t_n, n)))
    move_response = 1.0 + 4.0 * np.abs(daily_log_return)
    dollar_volume = pd.DataFrame(
        base_dollar_volume * volume_noise * move_response, index=dates, columns=tickers
    )

    return PriceData(prices=prices, dollar_volume=dollar_volume)


# ---------------------------------------------------------------------------
# Real data provider (yfinance)
# ---------------------------------------------------------------------------

def fetch_yfinance_data(
    tickers: list[str],
    start: str,
    end: str,
    chunk_size: int = 50,
    max_retries: int = 2,
) -> PriceData:
    """Download adjusted close and dollar volume from Yahoo Finance.

    Batches requests and retries individually dropped tickers, since a
    bulk download across many tickers at once occasionally loses a few
    names to rate limiting or a single bad connection rather than because
    the ticker genuinely has no data. Requires network access to Yahoo
    Finance; not usable in a network-restricted sandbox.
    """
    import yfinance as yf

    logger.info("Downloading price data for %d tickers from yfinance", len(tickers))
    price_series: dict[str, pd.Series] = {}
    volume_series: dict[str, pd.Series] = {}
    still_missing = list(tickers)

    for attempt in range(max_retries + 1):
        if not still_missing:
            break
        batch_size = chunk_size if attempt == 0 else 1
        batches = [still_missing[i : i + batch_size] for i in range(0, len(still_missing), batch_size)]
        newly_missing: list[str] = []

        for batch in batches:
            try:
                raw = yf.download(
                    batch, start=start, end=end, auto_adjust=True, progress=False, group_by="ticker"
                )
            except Exception as exc:
                logger.warning("Batch download failed (%s): %s", batch, exc)
                newly_missing.extend(batch)
                continue

            for ticker in batch:
                try:
                    close = raw[ticker]["Close"] if len(batch) > 1 else raw["Close"]
                    volume = raw[ticker]["Volume"] if len(batch) > 1 else raw["Volume"]
                    if close.dropna().empty:
                        newly_missing.append(ticker)
                        continue
                    price_series[ticker] = close
                    volume_series[ticker] = volume
                except (KeyError, TypeError):
                    newly_missing.append(ticker)

        still_missing = newly_missing

    for ticker in still_missing:
        logger.warning("No data available for %s after retries, dropping it", ticker)
    if not price_series:
        raise RuntimeError("No price data was successfully downloaded for any ticker.")

    prices = pd.concat(price_series, axis=1).sort_index().dropna(how="all")
    dollar_volume = pd.concat(
        {t: price_series[t] * volume_series[t] for t in price_series}, axis=1
    ).sort_index().reindex(prices.index)
    return PriceData(prices=prices, dollar_volume=dollar_volume)


# ---------------------------------------------------------------------------
# Cache + dispatch
# ---------------------------------------------------------------------------

def _cache_key(tickers: list[str], start: str, end: str, source: str, seed: int) -> str:
    raw = f"{source}|{start}|{end}|{seed}|{','.join(sorted(tickers))}"
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def load_price_data(
    tickers: list[str],
    sector_map: dict[str, str],
    start: str,
    end: str,
    source: str = "synthetic",
    seed: int = 7,
    use_cache: bool = True,
) -> PriceData:
    """Single entry point the rest of the codebase calls: dispatches to the
    synthetic generator or the real yfinance downloader, transparently
    caching the result to disk (parquet) so repeat runs with the same
    parameters — the common case when iterating on config in the web UI —
    are instant instead of re-downloading or re-simulating.
    """
    CACHE_DIR.mkdir(exist_ok=True)
    key = _cache_key(tickers, start, end, source, seed)
    price_path = CACHE_DIR / f"{key}_prices.parquet"
    volume_path = CACHE_DIR / f"{key}_volume.parquet"

    if use_cache and price_path.exists() and volume_path.exists():
        return PriceData(
            prices=pd.read_parquet(price_path),
            dollar_volume=pd.read_parquet(volume_path),
        )

    if source == "synthetic":
        data = generate_synthetic_market(tickers, sector_map, start, end, seed)
    elif source == "yfinance":
        data = fetch_yfinance_data(tickers, start, end)
    else:
        raise ValueError(f"Unknown data source: {source!r}")

    if use_cache:
        data.prices.to_parquet(price_path)
        data.dollar_volume.to_parquet(volume_path)

    return data
