"""Public routes (no auth) — mirrors internal/handlers/public.go."""

import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from databases import Database

import config
from auth_utils import new_id, rand_hex
from deps import get_db
from routers.audio import _do_upload

router = APIRouter(tags=["public"])


def _ok(data):
    return {"success": True, "data": data}


def _err(status: int, msg: str):
    raise HTTPException(status_code=status, detail={"success": False, "message": msg})


@router.get("/public/surveys/{slug}")
async def get_by_slug(slug: str, db: Database = Depends(get_db)):
    survey = await db.fetch_one(
        "SELECT * FROM surveys WHERE slug = :slug AND status = 'ACTIVE'", {"slug": slug}
    )
    if not survey:
        _err(404, "survey not found or not active")

    questions = await db.fetch_all(
        "SELECT * FROM questions WHERE survey_id = :sid ORDER BY order_index ASC",
        {"sid": survey["id"]},
    )
    return _ok({
        "id": survey["id"], "title": survey["title"],
        "description": survey["description"], "slug": survey["slug"],
        "config": survey["config"],
        "questions": [dict(q) for q in questions],
    })


@router.post("/public/surveys/{slug}/session")
async def start_session(slug: str, db: Database = Depends(get_db)):
    survey = await db.fetch_one(
        "SELECT id FROM surveys WHERE slug = :slug AND status = 'ACTIVE'", {"slug": slug}
    )
    if not survey:
        _err(404, "survey not found")

    sid = new_id()
    await db.execute(
        "INSERT INTO sessions (id, survey_id, status, sync_source, device_info) "
        "VALUES (:id, :survey, 'IN_PROGRESS', 'ONLINE', '{}')",
        {"id": sid, "survey": survey["id"]},
    )
    return _ok({"sessionId": sid, "surveyId": survey["id"]})


@router.post("/public/sessions/{session_id}/response", status_code=201)
async def submit_response(session_id: str, request: Request, db: Database = Depends(get_db)):
    body = await request.json()
    session = await db.fetch_one("SELECT id FROM sessions WHERE id = :id", {"id": session_id})
    if not session:
        _err(404, "session not found")

    rid = new_id()
    await db.execute(
        "INSERT INTO responses (id, session_id, question_id, type, text_value, "
        "audio_duration_sec, status) VALUES (:id, :sid, :qid, :type, :tv, :dur, 'SUBMITTED')",
        {
            "id": rid,
            "sid": session_id,
            "qid": body.get("questionId"),
            "type": body.get("type") or "SHORT_TEXT",
            "tv": body.get("textValue"),
            "dur": body.get("audioDurationSec"),
        },
    )
    return _ok({"responseId": rid})


@router.patch("/public/sessions/{session_id}/complete")
async def complete_session(session_id: str, db: Database = Depends(get_db)):
    session = await db.fetch_one("SELECT id FROM sessions WHERE id = :id", {"id": session_id})
    if not session:
        _err(404, "session not found")
    await db.execute(
        "UPDATE sessions SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW() WHERE id = :id",
        {"id": session_id},
    )
    return _ok({"sessionId": session_id, "status": "COMPLETED"})


@router.post("/public/images/upload/{response_id}", status_code=201)
async def upload_image(
    response_id: str,
    file: UploadFile = File(...),
    db: Database = Depends(get_db),
):
    session = await db.fetch_one(
        "SELECT id FROM sessions WHERE id = (SELECT session_id FROM responses WHERE id = :rid LIMIT 1)",
        {"rid": response_id},
    )
    if not session:
        _err(404, "response not found")

    ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
    if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic"):
        ext = ".jpg"

    img_dir = os.path.join(config.STORAGE_PATH, "images")
    os.makedirs(img_dir, exist_ok=True)
    save_path = os.path.join(img_dir, f"{response_id}{ext}")

    content = await file.read(50 * 1024 * 1024)  # 50 MB limit
    with open(save_path, "wb") as f:
        f.write(content)

    public_url = f"{config.STORAGE_URL}/images/{response_id}{ext}"
    await db.execute(
        "UPDATE responses SET text_value = :url, updated_at = NOW() WHERE id = :id",
        {"url": public_url, "id": response_id},
    )
    return _ok({"url": public_url, "bytes": len(content)})


@router.post("/public/audio/slot")
async def create_audio_slot(request: Request, db: Database = Depends(get_db)):
    body = await request.json()
    response_id = body.get("responseId") or ""
    mime_type = body.get("mimeType") or ""

    upload_id = rand_hex(8)
    ext = ".wav" if "wav" in mime_type else ".webm"

    raw_dir = os.path.join(config.STORAGE_PATH, "audio", "raw")
    os.makedirs(raw_dir, exist_ok=True)
    upload_path = os.path.join(raw_dir, f"{upload_id}{ext}")
    upload_url = f"{config.STORAGE_URL}/audio/raw/{upload_id}{ext}"

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


@router.post("/public/audio/upload/{upload_id}", status_code=201)
async def upload_audio(
    upload_id: str,
    file: UploadFile = File(...),
    responseId: str = Form(...),
    clientQcResult: str = Form(None),
    db: Database = Depends(get_db),
):
    return await _do_upload(upload_id, file, responseId, clientQcResult, db)
