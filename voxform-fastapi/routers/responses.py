"""Response routes — mirrors internal/handlers/response.go."""

import csv
import io
import json
import os
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from databases import Database

from auth_utils import new_id
from deps import get_current_user, get_db

router = APIRouter(tags=["responses"])


def _ok(data):
    return {"success": True, "data": data}


def _err(status: int, msg: str):
    raise HTTPException(status_code=status, detail={"success": False, "message": msg})


@router.get("/responses")
async def list_responses(
    page: int = 1, pageSize: int = 20, surveyId: str = "",
    sessionId: str = "", status: str = "",
    claims: dict = Depends(get_current_user), db: Database = Depends(get_db),
):
    where = ["su.org_id = :oid"]
    vals: dict = {"oid": claims["org_id"]}
    if surveyId:
        where.append("se.survey_id = :svid"); vals["svid"] = surveyId
    if sessionId:
        where.append("r.session_id = :ssid"); vals["ssid"] = sessionId
    if status:
        where.append("r.status = :status"); vals["status"] = status

    w = " AND ".join(where)
    total = (await db.fetch_one(
        f"SELECT COUNT(*) AS n FROM responses r "
        f"JOIN sessions se ON se.id = r.session_id "
        f"JOIN surveys su ON su.id = se.survey_id WHERE {w}", vals
    ))["n"]

    offset = (page - 1) * pageSize
    vals.update({"limit": pageSize, "offset": offset})
    rows = await db.fetch_all(
        f"SELECT r.* FROM responses r "
        f"JOIN sessions se ON se.id = r.session_id "
        f"JOIN surveys su ON su.id = se.survey_id "
        f"WHERE {w} ORDER BY r.created_at DESC LIMIT :limit OFFSET :offset", vals
    )
    return _ok({"data": [dict(r) for r in rows], "meta": {"total": total, "page": page}})


@router.get("/responses/export/zip")
async def export_zip(
    surveyId: str = "",
    claims: dict = Depends(get_current_user),
    db: Database = Depends(get_db),
):
    if not surveyId:
        _err(400, "surveyId required")

    survey = await db.fetch_one(
        "SELECT id, title FROM surveys WHERE id = :id AND org_id = :oid",
        {"id": surveyId, "oid": claims["org_id"]},
    )
    if not survey:
        _err(404, "survey not found")

    questions = await db.fetch_all(
        "SELECT id, type, title, order_index FROM questions WHERE survey_id = :sid ORDER BY order_index",
        {"sid": surveyId},
    )
    sessions = await db.fetch_all(
        "SELECT id, status, created_at, respondent_ref FROM sessions WHERE survey_id = :sid ORDER BY created_at",
        {"sid": surveyId},
    )
    responses = await db.fetch_all(
        "SELECT r.id, r.session_id, r.question_id, r.type, r.status, r.text_value, "
        "r.audio_url, r.audio_wav_url, r.audio_duration_sec, r.transcript, "
        "aj.wav_path AS audio_file_path "
        "FROM responses r "
        "JOIN sessions se ON se.id = r.session_id "
        "LEFT JOIN audio_jobs aj ON aj.response_id = r.id "
        "WHERE se.survey_id = :sid",
        {"sid": surveyId},
    )

    AUDIO_TYPES = {"VOICE_RESPONSE", "AUDIO_CAPTURE", "AUDIO_QUESTION"}

    # Group by session → question
    by_session: dict = {}
    for r in responses:
        s = r["session_id"]
        if s not in by_session:
            by_session[s] = {}
        by_session[s][r["question_id"]] = dict(r)

    # Build CSV
    csv_buf = io.StringIO()
    writer = csv.writer(csv_buf)
    writer.writerow(
        ["session_id", "date", "status", "respondent_ref"]
        + [q["title"] for q in questions]
    )

    audio_files: list[tuple[str, str]] = []  # (zip_path, disk_path)
    for sess in sessions:
        sid = sess["id"]
        rm = by_session.get(sid, {})
        cols = []
        for q in questions:
            r = rm.get(q["id"])
            if not r:
                cols.append("")
            elif q["type"] in AUDIO_TYPES:
                disk = r.get("audio_file_path") or ""
                if disk and os.path.exists(disk):
                    ext = Path(disk).suffix
                    zname = f"audio/{sid[:8]}_{q['id'][:8]}{ext}"
                    audio_files.append((zname, disk))
                    cols.append(zname)
                else:
                    cols.append(r.get("audio_url") or r.get("audio_wav_url") or "")
            else:
                cols.append(r.get("text_value") or "")
        writer.writerow([sid, str(sess["created_at"]), sess["status"], sess.get("respondent_ref") or ""] + cols)

    # Build ZIP
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        safe_title = (survey["title"] or "responses").replace(" ", "_")
        zf.writestr(f"{safe_title}_responses.csv", csv_buf.getvalue())
        for zname, disk_path in audio_files:
            try:
                zf.write(disk_path, zname)
            except Exception:
                pass

    zip_buf.seek(0)
    filename = f"{safe_title}_export.zip"
    return StreamingResponse(
        iter([zip_buf.read()]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/responses/{response_id}")
async def get_response(response_id: str, claims: dict = Depends(get_current_user),
                       db: Database = Depends(get_db)):
    row = await db.fetch_one(
        "SELECT r.* FROM responses r "
        "JOIN sessions se ON se.id = r.session_id "
        "JOIN surveys su ON su.id = se.survey_id "
        "WHERE r.id = :id AND su.org_id = :oid",
        {"id": response_id, "oid": claims["org_id"]},
    )
    if not row:
        _err(404, "response not found")
    return _ok(dict(row))


@router.post("/responses", status_code=201)
async def create_response(request: Request, claims: dict = Depends(get_current_user),
                          db: Database = Depends(get_db)):
    body = await request.json()
    rid = new_id()
    await db.execute(
        "INSERT INTO responses (id, session_id, question_id, type, text_value, audio_url, "
        "audio_wav_url, audio_duration_sec, qc_result, status) "
        "VALUES (:id, :sid, :qid, :type, :tv, :au, :awu, :dur, :qc, 'SUBMITTED')",
        {
            "id": rid,
            "sid": body.get("sessionId"),
            "qid": body.get("questionId"),
            "type": body.get("type") or "SHORT_TEXT",
            "tv": body.get("textValue"),
            "au": body.get("audioUrl"),
            "awu": body.get("audioWavUrl"),
            "dur": body.get("audioDurationSec"),
            "qc": json.dumps(body["qcResult"]) if "qcResult" in body else None,
        },
    )
    row = await db.fetch_one("SELECT * FROM responses WHERE id = :id", {"id": rid})
    return _ok(dict(row))


async def _review(response_id: str, status: str, claims: dict, db: Database):
    row = await db.fetch_one(
        "SELECT r.id FROM responses r "
        "JOIN sessions se ON se.id = r.session_id "
        "JOIN surveys su ON su.id = se.survey_id "
        "WHERE r.id = :id AND su.org_id = :oid",
        {"id": response_id, "oid": claims["org_id"]},
    )
    if not row:
        _err(404, "response not found")
    await db.execute(
        "UPDATE responses SET status = :s, reviewed_by = :uid, reviewed_at = NOW(), "
        "updated_at = NOW() WHERE id = :id",
        {"s": status, "uid": claims["sub"], "id": response_id},
    )
    updated = await db.fetch_one("SELECT * FROM responses WHERE id = :id", {"id": response_id})
    return _ok(dict(updated))


@router.patch("/responses/{response_id}/approve")
async def approve(response_id: str, claims: dict = Depends(get_current_user),
                  db: Database = Depends(get_db)):
    return await _review(response_id, "APPROVED", claims, db)


@router.patch("/responses/{response_id}/reject")
async def reject(response_id: str, claims: dict = Depends(get_current_user),
                 db: Database = Depends(get_db)):
    return await _review(response_id, "REJECTED", claims, db)


@router.get("/responses/{response_id}/audio-job")
async def audio_job(response_id: str, claims: dict = Depends(get_current_user),
                    db: Database = Depends(get_db)):
    # Verify org access
    row = await db.fetch_one(
        "SELECT r.id FROM responses r "
        "JOIN sessions se ON se.id = r.session_id "
        "JOIN surveys su ON su.id = se.survey_id "
        "WHERE r.id = :id AND su.org_id = :oid",
        {"id": response_id, "oid": claims["org_id"]},
    )
    if not row:
        _err(404, "response not found")

    job = await db.fetch_one(
        "SELECT * FROM audio_jobs WHERE response_id = :id", {"id": response_id}
    )
    if not job:
        return _ok({"status": "NOT_STARTED"})
    return _ok(dict(job))
