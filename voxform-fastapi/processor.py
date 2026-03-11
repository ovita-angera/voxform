"""Audio pipeline processor — mirrors internal/queue/processor.go.

Pipeline:
    1. Load audio_jobs record
    2. Set status → QC_PASSED
    3. ffmpeg → 16kHz mono WAV  (best-effort)
    4. Groq Whisper transcription  (if GROQ_API_KEY set)
    5. Claude extraction           (if ANTHROPIC_API_KEY set)
    6. Set status → COMPLETE
"""

import asyncio
import json
import logging
import os
import time
from pathlib import Path

import httpx

import config
from job_queue import Job

logger = logging.getLogger("processor")


async def process(job: Job) -> None:
    response_id: str = job.payload.get("responseId", "")
    if not response_id:
        raise ValueError("missing responseId in payload")

    start_ms = time.time()
    logger.info("audio pipeline started: %s", response_id)

    db = _get_db()

    # Load audio_jobs record
    audio_job = await db.fetch_one(
        "SELECT id, wav_path FROM audio_jobs WHERE response_id = :rid LIMIT 1",
        {"rid": response_id},
    )
    if audio_job is None:
        raise ValueError(f"audio_job not found for response {response_id}")

    job_id = audio_job["id"]
    wav_path: str = audio_job["wav_path"] or ""

    await db.execute(
        "UPDATE audio_jobs SET status = 'QC_PASSED', updated_at = NOW() WHERE id = :id",
        {"id": job_id},
    )

    # Convert to WAV if not already
    if wav_path and not wav_path.endswith(".wav"):
        try:
            wav_path = await _convert_to_wav(wav_path)
            await db.execute(
                "UPDATE audio_jobs SET wav_path = :p, updated_at = NOW() WHERE id = :id",
                {"p": wav_path, "id": job_id},
            )
        except Exception as exc:
            logger.warning("ffmpeg unavailable — proceeding with original: %s", exc)

    # Transcription
    if config.GROQ_API_KEY and wav_path and os.path.exists(wav_path):
        await db.execute(
            "UPDATE audio_jobs SET status = 'TRANSCRIBING', updated_at = NOW() WHERE id = :id",
            {"id": job_id},
        )
        try:
            transcript = await _transcribe_groq(wav_path)
            t_json = json.dumps(transcript)
            await db.execute(
                "UPDATE audio_jobs SET transcript_raw = :t, updated_at = NOW() WHERE id = :id",
                {"t": t_json, "id": job_id},
            )
            await db.execute(
                "UPDATE responses SET transcript = :t, status = 'PROCESSING', updated_at = NOW() WHERE id = :id",
                {"t": t_json, "id": response_id},
            )

            # Extraction
            if config.ANTHROPIC_API_KEY:
                await db.execute(
                    "UPDATE audio_jobs SET status = 'EXTRACTING', updated_at = NOW() WHERE id = :id",
                    {"id": job_id},
                )
                try:
                    text = transcript.get("text", "")
                    extracted = await _extract_claude(text, response_id)
                    e_json = json.dumps(extracted)
                    confidence = extracted.get("confidence", 0.0)
                    await db.execute(
                        "UPDATE responses SET extracted_value = :e, confidence_score = :c, "
                        "status = 'REVIEWED', updated_at = NOW() WHERE id = :id",
                        {"e": e_json, "c": confidence, "id": response_id},
                    )
                    await db.execute(
                        "UPDATE audio_jobs SET extracted_data = :e, updated_at = NOW() WHERE id = :id",
                        {"e": e_json, "id": job_id},
                    )
                except Exception as exc:
                    logger.warning("extraction failed — skipping: %s", exc)
        except Exception as exc:
            logger.warning("transcription failed — skipping: %s", exc)

    # Build public URL for the final audio file and write it back to responses
    if wav_path and os.path.exists(wav_path):
        storage_abs = os.path.abspath(config.STORAGE_PATH)
        wav_abs = os.path.abspath(wav_path)
        try:
            rel = os.path.relpath(wav_abs, storage_abs).replace(os.sep, "/")
            public_url = f"{config.STORAGE_URL}/{rel}"
        except ValueError:
            public_url = None
        if public_url:
            await db.execute(
                "UPDATE responses SET audio_url = :u, audio_wav_url = :u, updated_at = NOW() WHERE id = :id",
                {"u": public_url, "id": response_id},
            )

    processing_ms = int((time.time() - start_ms) * 1000)
    await db.execute(
        "UPDATE audio_jobs SET status = 'COMPLETE', processing_ms = :ms, updated_at = NOW() WHERE id = :id",
        {"ms": processing_ms, "id": job_id},
    )
    await db.execute(
        "UPDATE responses SET status = 'SUBMITTED', updated_at = NOW() "
        "WHERE id = :id AND status = 'PROCESSING'",
        {"id": response_id},
    )
    logger.info("audio pipeline complete: %s (%dms)", response_id, processing_ms)


async def _convert_to_wav(input_path: str) -> str:
    stem = Path(input_path).with_suffix("").as_posix()
    output_path = stem + ".wav"
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-i", input_path,
        "-ar", "16000", "-ac", "1", "-sample_fmt", "s16",
        output_path, "-y",
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {stderr.decode()}")
    return output_path


async def _transcribe_groq(audio_path: str) -> dict:
    with open(audio_path, "rb") as f:
        audio_bytes = f.read()
    filename = os.path.basename(audio_path)
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {config.GROQ_API_KEY}"},
            files={"file": (filename, audio_bytes)},
            data={"model": "whisper-large-v3", "response_format": "verbose_json"},
        )
    if resp.status_code != 200:
        raise RuntimeError(f"Groq {resp.status_code}: {resp.text}")
    result = resp.json()
    result["provider"] = "groq"
    return result


async def _extract_claude(transcript_text: str, response_id: str) -> dict:
    db = _get_db()
    row = await db.fetch_one(
        "SELECT q.title FROM questions q "
        "JOIN responses r ON r.question_id = q.id "
        "WHERE r.id = :id LIMIT 1",
        {"id": response_id},
    )
    question_title = row["title"] if row else ""

    prompt = (
        f'Question: "{question_title}"\n\n'
        f'Transcript: "{transcript_text}"\n\n'
        "Extract a concise answer from this transcript. Respond ONLY with valid JSON:\n"
        '{"answer":"...","confidence":0.0,"keyPoints":[]}\n\n'
        "Rules: answer should be 1-3 sentences. confidence is 0.0-1.0. "
        "keyPoints are brief phrases."
    )

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "Content-Type": "application/json",
                "x-api-key": config.ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 300,
                "messages": [{"role": "user", "content": prompt}],
            },
        )

    if resp.status_code != 200:
        raise RuntimeError(f"Claude {resp.status_code}: {resp.text}")

    data = resp.json()
    text = data.get("content", [{}])[0].get("text", "").strip()
    # Strip markdown fences
    for fence in ("```json", "```"):
        text = text.removeprefix(fence)
    text = text.removesuffix("```").strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"answer": text, "confidence": 0.5, "keyPoints": []}


def _get_db():
    import database
    return database.db
