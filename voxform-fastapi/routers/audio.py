"""Audio routes (authenticated) — mirrors internal/handlers/audio.go."""

import json
import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from databases import Database

import config
from auth_utils import new_id, rand_hex
from deps import get_current_user, get_db
import job_queue as jobqueue

router = APIRouter(tags=["audio"])


def _ok(data):
    return {"success": True, "data": data}


def _err(status: int, msg: str):
    raise HTTPException(status_code=status, detail={"success": False, "message": msg})


@router.post("/audio/upload-slot")
async def create_slot(request: Request, claims: dict = Depends(get_current_user),
                      db: Database = Depends(get_db)):
    body = await request.json()
    response_id = body.get("responseId") or ""
    mime_type = body.get("mimeType") or ""

    upload_id = rand_hex(8)  # 16-char hex
    ext = ".wav" if "wav" in mime_type else ".webm"

    raw_dir = os.path.join(config.STORAGE_PATH, "audio", "raw")
    os.makedirs(raw_dir, exist_ok=True)
    upload_path = os.path.join(raw_dir, f"{upload_id}{ext}")
    upload_url = f"{config.STORAGE_URL}/audio/raw/{upload_id}{ext}"

    # Upsert audio_jobs
    existing = await db.fetch_one(
        "SELECT id FROM audio_jobs WHERE response_id = :rid", {"rid": response_id}
    )
    if existing:
        await db.execute(
            "UPDATE audio_jobs SET status = 'UPLOADING', wav_path = :p, updated_at = NOW() WHERE id = :id",
            {"p": upload_path, "id": existing["id"]},
        )
    else:
        await db.execute(
            "INSERT INTO audio_jobs (id, response_id, status, wav_path) VALUES (:id, :rid, 'UPLOADING', :p)",
            {"id": new_id(), "rid": response_id, "p": upload_path},
        )

    return _ok({"uploadId": upload_id, "uploadPath": upload_path, "uploadUrl": upload_url})


@router.post("/audio/upload/{upload_id}", status_code=201)
async def upload(
    upload_id: str,
    file: UploadFile = File(...),
    responseId: str = Form(...),
    clientQcResult: str = Form(None),
    claims: dict = Depends(get_current_user),
    db: Database = Depends(get_db),
):
    return await _do_upload(upload_id, file, responseId, clientQcResult, db)


@router.get("/audio/job/{response_id}")
async def job_status(response_id: str, claims: dict = Depends(get_current_user),
                     db: Database = Depends(get_db)):
    # Verify org access via JOIN
    row = await db.fetch_one(
        "SELECT r.id FROM responses r "
        "JOIN sessions se ON se.id = r.session_id "
        "JOIN surveys su ON su.id = se.survey_id "
        "WHERE r.id = :id AND su.org_id = :oid",
        {"id": response_id, "oid": claims["org_id"]},
    )
    if not row:
        _err(404, "response not found")

    job = await db.fetch_one("SELECT * FROM audio_jobs WHERE response_id = :id", {"id": response_id})
    if not job:
        return _ok({"status": "NOT_STARTED"})
    return _ok(dict(job))


# ── Shared upload logic (used by authenticated + public routers) ──────────────

async def _do_upload(upload_id: str, file: UploadFile, response_id: str,
                     client_qc_result: str | None, db: Database):
    # Determine file path from audio_jobs record
    job = await db.fetch_one("SELECT * FROM audio_jobs WHERE response_id = :rid", {"rid": response_id})
    if not job:
        raise HTTPException(404, detail={"success": False, "message": "audio job not found"})

    save_path: str = job["wav_path"] or ""
    if not save_path:
        ext = ".wav" if (file.content_type or "").find("wav") >= 0 else ".webm"
        raw_dir = os.path.join(config.STORAGE_PATH, "audio", "raw")
        os.makedirs(raw_dir, exist_ok=True)
        save_path = os.path.join(raw_dir, f"{upload_id}{ext}")

    # Write file (200 MB limit)
    content = await file.read(200 * 1024 * 1024)
    with open(save_path, "wb") as f:
        f.write(content)

    if client_qc_result:
        try:
            qc_json = json.loads(client_qc_result)
            await db.execute(
                "UPDATE responses SET qc_result = :qc, updated_at = NOW() WHERE id = :id",
                {"qc": json.dumps(qc_json), "id": response_id},
            )
        except Exception:
            pass

    await db.execute(
        "UPDATE audio_jobs SET status = 'QC_PENDING', wav_path = :p, updated_at = NOW() WHERE response_id = :rid",
        {"p": save_path, "rid": response_id},
    )

    await jobqueue.enqueue("audio:process", {"responseId": response_id})

    return {"success": True, "data": {
        "jobId": job["id"],
        "bytes": len(content),
        "filename": file.filename,
    }}
