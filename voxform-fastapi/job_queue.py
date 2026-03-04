"""Async job queue — mirrors internal/queue/queue.go.

Worker pool backed by asyncio.Queue with exponential-backoff retry (max 3 attempts).
"""

import asyncio
import dataclasses
import logging
from typing import Awaitable, Callable

from auth_utils import new_id

logger = logging.getLogger("queue")

Handler = Callable[["Job"], Awaitable[None]]

_queue: asyncio.Queue["Job"] = asyncio.Queue(maxsize=500)
_handlers: dict[str, Handler] = {}


@dataclasses.dataclass
class Job:
    id: str
    type: str
    payload: dict
    attempts: int = 0


def register(job_type: str, handler: Handler) -> None:
    _handlers[job_type] = handler


async def enqueue(job_type: str, payload: dict) -> None:
    job = Job(id=new_id(), type=job_type, payload=payload)
    try:
        _queue.put_nowait(job)
    except asyncio.QueueFull:
        logger.warning("queue full — job dropped: %s", job_type)


async def start(db, workers: int = 3) -> None:
    """Recover stale jobs from a previous run, then launch worker tasks."""
    rows = await db.fetch_all(
        "SELECT response_id FROM audio_jobs WHERE status IN ('QUEUED','UPLOADING')"
    )
    for row in rows:
        await enqueue("audio:process", {"responseId": row["response_id"]})

    for i in range(workers):
        asyncio.create_task(_worker(i), name=f"queue-worker-{i}")


async def _worker(worker_id: int) -> None:
    logger.info("worker %d started", worker_id)
    while True:
        job = await _queue.get()
        await _run(job)
        _queue.task_done()


async def _run(job: Job) -> None:
    handler = _handlers.get(job.type)
    if handler is None:
        logger.warning("no handler for job type: %s", job.type)
        return
    try:
        await handler(job)
        logger.info("job done: %s id=%s", job.type, job.id)
    except Exception as exc:
        job.attempts += 1
        logger.error("job failed (attempt %d): %s — %s", job.attempts, job.type, exc)
        if job.attempts < 3:
            delay = (job.attempts ** 2) * 5  # 5s, 20s, 45s
            await asyncio.sleep(delay)
            await enqueue(job.type, job.payload)
