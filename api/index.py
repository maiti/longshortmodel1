"""Vercel serverless entrypoint. Vercel's Python builder detects the
`app` ASGI object below and serves it directly — no uvicorn, no Mangum
adapter needed. `vercel.json` rewrites every `/api/*` request to this one
function; FastAPI's own router (in webapp.api_app) dispatches from there.

This file intentionally does nothing but re-export the shared app: static
frontend files are served straight from `/public` by Vercel's CDN, never
through this function.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from webapp.api_app import app  # noqa: E402  (path must be set up first)

__all__ = ["app"]
