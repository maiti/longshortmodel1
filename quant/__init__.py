"""Long/short equity factor model package.

Subpackages/modules:
    config      - all tunable parameters (ModelConfig)
    universe    - ticker list and GICS sector map
    data        - price/volume data providers (synthetic + yfinance) and caching
    factors     - per-stock factor computations
    portfolio   - composite scoring, position sizing, risk controls, costs
    backtest    - the engine that turns weights into a return series
    validation  - information coefficient, significance, walk-forward analysis
    pipeline    - wires all of the above into one reproducible run
"""
