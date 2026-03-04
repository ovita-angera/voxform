"""Voxform FastAPI backend — drop-in replacement for voxform-go.

Start with:  uvicorn main:app --port 4000 --reload
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import config
import database
import job_queue as jobqueue
import processor
from routers import auth, users, surveys, questions, sessions, responses, audio, public

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    await database.connect()
    logger.info("database connected")

    await database.run_migrations()
    logger.info("migrations complete")

    jobqueue.register("audio:process", processor.process)
    await jobqueue.start(database.db, workers=3)
    logger.info("job queue started")

    logger.info("🚀 Voxform API started  http://localhost:%s/api/v1", config.PORT)
    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    await database.disconnect()
    logger.info("database disconnected")


app = FastAPI(title="Voxform API", version="1.0.0", lifespan=lifespan)

# CORS — mirrors Go cors.Handler config
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Accept", "Authorization", "Content-Type", "X-Request-ID"],
    max_age=300,
)

# Static file serving (audio uploads) — mirrors Go http.FileServer("/storage")
_storage = os.path.abspath(config.STORAGE_PATH)
os.makedirs(_storage, exist_ok=True)
app.mount("/storage", StaticFiles(directory=_storage), name="storage")

# Register all routers under /api/v1
_prefix = "/api/v1"
app.include_router(auth.router,      prefix=_prefix)
app.include_router(users.router,     prefix=_prefix)
app.include_router(surveys.router,   prefix=_prefix)
app.include_router(questions.router, prefix=_prefix)
app.include_router(sessions.router,  prefix=_prefix)
app.include_router(responses.router, prefix=_prefix)
app.include_router(audio.router,     prefix=_prefix)
app.include_router(public.router,    prefix=_prefix)
