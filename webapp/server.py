"""FastAPI backend for the model's web UI.

Two jobs: run the model with a given configuration and hand back the full
result JSON (the same structure `scripts/run_model.py` prints to the
terminal), and describe every tunable parameter in plain language so the
frontend can render controls with real explanations instead of bare field
names. No trading, brokerage, or account logic lives here — this only ever
runs a backtest against historical or synthetic data.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from quant.config import ModelConfig
from quant.pipeline import run_full_pipeline
from webapp.config_schema import CONFIG_SCHEMA

STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(title="Long/Short Equity Factor Model")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

_latest_result: dict[str, Any] | None = None


@app.get("/api/config/schema")
def get_config_schema() -> dict[str, Any]:
    defaults = ModelConfig().to_dict()
    for group in CONFIG_SCHEMA:
        for field in group["fields"]:
            field["default"] = defaults[field["key"]]
    return {"groups": CONFIG_SCHEMA}


@app.post("/api/run")
async def run_model(overrides: dict[str, Any]) -> dict[str, Any]:
    global _latest_result
    try:
        config = ModelConfig.from_dict(overrides)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        result = await run_in_threadpool(run_full_pipeline, config, True)
    except Exception as exc:  # noqa: BLE001 - surface any pipeline error to the UI
        raise HTTPException(status_code=500, detail=f"Run failed: {exc}") from exc

    _latest_result = result
    return result


@app.get("/api/result/latest")
def get_latest_result() -> dict[str, Any]:
    if _latest_result is None:
        raise HTTPException(status_code=404, detail="No run has completed yet. POST /api/run first.")
    return _latest_result


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/", StaticFiles(directory=str(STATIC_DIR)), name="static")
