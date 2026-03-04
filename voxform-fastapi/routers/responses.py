"""Response routes — mirrors internal/handlers/response.go."""

import json

from fastapi import APIRouter, Depends, HTTPException, Request
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
