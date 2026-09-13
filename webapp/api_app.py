"""The actual API: two routes, shared verbatim between the local dev
server (`webapp/server.py`, which adds a static file mount on top of this)
and the Vercel serverless function (`api/index.py`, which re-exports this
`app` as-is — Vercel serves the frontend's static files separately, from
`/public`, so the deployed function never needs to know about them).

No trading, brokerage, or account logic lives here — this only ever runs
a backtest against historical or synthetic data and returns JSON.

Every route is registered at TWO paths: a semantic one
(/api/config/schema, /api/run) for local development, curl, and the
auto-generated /docs page, and /api/index (still split by HTTP method)
for production. The second one exists because of a genuinely surprising
Vercel behavior, confirmed from a live function log rather than assumed:
for a detected "backend framework" project, vercel.json's catch-all
rewrite doesn't just pick which function handles a request while leaving
the browser-visible path alone (the usual meaning of "rewrite") — it
replaces the path the ASGI app itself receives with the literal rewrite
destination. A request to /api/run and one to /api/config/schema both
arrive here as path=/api/index, method preserved; without a route
registered at that literal path, FastAPI's own router 404s both. See
README's "Deploying to Vercel" section for the full story.
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from quant.config import ModelConfig
from quant.pipeline import run_full_pipeline
from webapp.config_schema import CONFIG_SCHEMA

# Caching is on everywhere, including Vercel: /tmp is wiped between cold
# starts, so it buys nothing on a genuinely fresh invocation, but a warm
# container (the common case while someone is actively experimenting with
# the same date range/tickers/seed in the UI) reuses it across requests --
# which matters a lot for the yfinance data source specifically, since
# re-downloading ~94 tickers of history on every single click risks the
# function timeout for no reason once the first call already paid for it.
USE_DATA_CACHE = True

app = FastAPI(title="Long/Short Equity Factor Model API")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


def _build_config_schema() -> dict[str, Any]:
    # FastAPI can run plain `def` routes concurrently in a threadpool, so
    # two overlapping requests must never mutate the same shared object --
    # deep-copy CONFIG_SCHEMA (a module-level list) before filling in
    # defaults, rather than editing it in place.
    defaults = ModelConfig().to_dict()
    schema = copy.deepcopy(CONFIG_SCHEMA)
    for group in schema:
        for field in group["fields"]:
            field["default"] = defaults[field["key"]]
    return {"groups": schema}


async def _run_model(overrides: dict[str, Any]) -> dict[str, Any]:
    try:
        config = ModelConfig.from_dict(overrides)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        return await run_in_threadpool(run_full_pipeline, config, USE_DATA_CACHE)
    except Exception as exc:  # noqa: BLE001 - surface any pipeline error to the UI
        raise HTTPException(status_code=500, detail=f"Run failed: {exc}") from exc


@app.get("/api/config/schema")
def get_config_schema() -> dict[str, Any]:
    return _build_config_schema()


@app.post("/api/run")
async def run_model(overrides: dict[str, Any]) -> dict[str, Any]:
    return await _run_model(overrides)


@app.get("/api/index")
def get_config_schema_prod() -> dict[str, Any]:
    return _build_config_schema()


@app.post("/api/index")
async def run_model_prod(overrides: dict[str, Any]) -> dict[str, Any]:
    return await _run_model(overrides)
