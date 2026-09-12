"""The stock universe: which tickers the model trades, and which GICS
sector each one belongs to.

This list is deliberately smaller than the full S&P 500 (roughly 120 names
versus ~500). Two reasons:

1. It keeps a demo run (synthetic data, or a real yfinance pull) fast
   enough to use interactively from the web UI, while still being large
   enough that the long/short buckets (20% each way) hold ~24 names per
   side rather than the 6-per-side noise floor a 30-stock universe hits.
2. It is used both by the synthetic data generator (as tickers to
   simulate) and by the real yfinance provider (as tickers to download),
   so the two code paths are exercised against the identical universe and
   sector structure.

Extend TICKERS / SECTOR_MAP with more names (a full S&P 500 snapshot, for
example) for a production run against real data; nothing else in the
codebase assumes this specific size or these specific tickers.
"""

from __future__ import annotations

SECTOR_MAP: dict[str, str] = {
    # Information Technology
    "AAPL": "Information Technology", "MSFT": "Information Technology",
    "NVDA": "Information Technology", "AVGO": "Information Technology",
    "ORCL": "Information Technology", "CRM": "Information Technology",
    "ADBE": "Information Technology", "CSCO": "Information Technology",
    "AMD": "Information Technology", "INTC": "Information Technology",
    "QCOM": "Information Technology", "TXN": "Information Technology",
    # Health Care
    "UNH": "Health Care", "JNJ": "Health Care", "LLY": "Health Care",
    "ABBV": "Health Care", "MRK": "Health Care", "PFE": "Health Care",
    "TMO": "Health Care", "ABT": "Health Care", "DHR": "Health Care",
    "BMY": "Health Care", "AMGN": "Health Care", "GILD": "Health Care",
    # Financials
    "BRK-B": "Financials", "JPM": "Financials", "V": "Financials",
    "MA": "Financials", "BAC": "Financials", "WFC": "Financials",
    "GS": "Financials", "MS": "Financials", "SPGI": "Financials",
    "AXP": "Financials", "SCHW": "Financials", "BLK": "Financials",
    # Consumer Discretionary
    "AMZN": "Consumer Discretionary", "TSLA": "Consumer Discretionary",
    "HD": "Consumer Discretionary", "MCD": "Consumer Discretionary",
    "NKE": "Consumer Discretionary", "LOW": "Consumer Discretionary",
    "SBUX": "Consumer Discretionary", "TJX": "Consumer Discretionary",
    "BKNG": "Consumer Discretionary", "ORLY": "Consumer Discretionary",
    "MAR": "Consumer Discretionary",
    # Communication Services
    "GOOGL": "Communication Services", "META": "Communication Services",
    "NFLX": "Communication Services", "DIS": "Communication Services",
    "CMCSA": "Communication Services", "TMUS": "Communication Services",
    "VZ": "Communication Services", "T": "Communication Services",
    # Industrials
    "GE": "Industrials", "CAT": "Industrials", "RTX": "Industrials",
    "HON": "Industrials", "UNP": "Industrials", "BA": "Industrials",
    "UPS": "Industrials", "LMT": "Industrials", "DE": "Industrials",
    "ADP": "Industrials",
    # Consumer Staples
    "PG": "Consumer Staples", "KO": "Consumer Staples", "PEP": "Consumer Staples",
    "COST": "Consumer Staples", "WMT": "Consumer Staples", "PM": "Consumer Staples",
    "MDLZ": "Consumer Staples", "CL": "Consumer Staples",
    # Energy
    "XOM": "Energy", "CVX": "Energy", "COP": "Energy", "SLB": "Energy",
    "EOG": "Energy", "PSX": "Energy",
    # Utilities
    "NEE": "Utilities", "DUK": "Utilities", "SO": "Utilities",
    "AEP": "Utilities", "D": "Utilities",
    # Real Estate
    "PLD": "Real Estate", "AMT": "Real Estate", "EQIX": "Real Estate",
    "PSA": "Real Estate", "O": "Real Estate",
    # Materials
    "LIN": "Materials", "SHW": "Materials", "APD": "Materials",
    "ECL": "Materials", "NEM": "Materials",
}

TICKERS: list[str] = sorted(SECTOR_MAP.keys())


def sector_of(ticker: str) -> str:
    """Sector for one ticker, defaulting to the ticker itself when unknown
    so it degrades to acting as its own one-member sector instead of
    crashing sector neutralization on an unexpected symbol.
    """
    return SECTOR_MAP.get(ticker, ticker)
