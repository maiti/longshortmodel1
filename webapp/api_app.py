"""The actual API: two routes, shared verbatim between the local dev
server (`webapp/server.py`, which adds a static file mount on top of this)
and the Vercel serverless function (`api/index.py`, which re-exports this
`app` as-is — Vercel serves the frontend's static files separately, from
`/public`, so the deployed function never needs to know about them).

No trading, brokerage, or account logic lives here — this only ever runs
a backtest against historical or synthetic data and returns JSON.
"""

from __future__ import annotations

import copy
import os
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

# Vercel's filesystem is read-only outside /tmp, and /tmp is wiped between
# cold starts, so a disk-backed parquet cache buys almost nothing there
# while costing an extra dependency (pyarrow) in the deployed bundle --
# skip it in that environment and just regenerate/redownload each call.
# Locally, caching makes repeated UI experimentation fast.
USE_DATA_CACHE = not bool(os.environ.get("VERCEL"))

app = FastAPI(title="Long/Short Equity Factor Model API")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.get("/api/config/schema")
def get_config_schema() -> dict[str, Any]:
    # FastAPI runs a plain `def` route in a threadpool, so two requests to
    # this endpoint can genuinely execute concurrently. The previous
    # version mutated CONFIG_SCHEMA (a module-level, process-wide list) in
    # place on every call -- two overlapping requests could interleave
    # their writes to the same shared field dicts. Deep-copying first
    # means each request builds and returns its own independent tree.
    defaults = ModelConfig().to_dict()
    schema = copy.deepcopy(CONFIG_SCHEMA)
    for group in schema:
        for field in group["fields"]:
            field["default"] = defaults[field["key"]]
    return {"groups": schema}


@app.post("/api/run")
async def run_model(overrides: dict[str, Any]) -> dict[str, Any]:
    try:
        config = ModelConfig.from_dict(overrides)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        result = await run_in_threadpool(run_full_pipeline, config, USE_DATA_CACHE)
    except Exception as exc:  # noqa: BLE001 - surface any pipeline error to the UI
        raise HTTPException(status_code=500, detail=f"Run failed: {exc}") from exc

    return result
