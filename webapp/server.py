"""Local development server: the shared API routes from `webapp.api_app`,
plus a static file mount for `/public` (the same frontend Vercel serves
directly from its CDN in production — see `vercel.json`).

Run with: uvicorn webapp.server:app --reload
"""

from __future__ import annotations

from pathlib import Path

from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from webapp.api_app import app

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"


@app.get("/")
def index() -> FileResponse:
    return FileResponse(PUBLIC_DIR / "index.html")


app.mount("/", StaticFiles(directory=str(PUBLIC_DIR)), name="static")
