"""Session routes — mirrors internal/handlers/session.go."""

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from databases import Database

from auth_utils import new_id
from deps import get_current_user, get_db

router = APIRouter(tags=["sessions"])


def _ok(data):
    return {"success": True, "data": data}


def _err(status: int, msg: str):
    raise HTTPException(status_code=status, detail={"success": False, "message": msg})


@router.get("/sessions")
async def list_sessions(
    page: int = 1, pageSize: int = 20, surveyId: str = "", status: str = "",
    claims: dict = Depends(get_current_user), db: Database = Depends(get_db),
):
    where = ["su.org_id = :oid"]
    vals: dict = {"oid": claims["org_id"]}
    if surveyId:
        where.append("s.survey_id = :sid"); vals["sid"] = surveyId
    if status:
        where.append("s.status = :status"); vals["status"] = status

    w = " AND ".join(where)
    total = (await db.fetch_one(
        f"SELECT COUNT(*) AS n FROM sessions s "
        f"JOIN surveys su ON su.id = s.survey_id WHERE {w}", vals
    ))["n"]

    offset = (page - 1) * pageSize
    vals.update({"limit": pageSize, "offset": offset})
    rows = await db.fetch_all(
        f"SELECT s.* FROM sessions s JOIN surveys su ON su.id = s.survey_id "
        f"WHERE {w} ORDER BY s.created_at DESC LIMIT :limit OFFSET :offset", vals
    )
    return _ok({"data": [dict(r) for r in rows], "meta": {"total": total}})


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, claims: dict = Depends(get_current_user),
                      db: Database = Depends(get_db)):
    row = await db.fetch_one(
        "SELECT s.* FROM sessions s JOIN surveys su ON su.id = s.survey_id "
        "WHERE s.id = :id AND su.org_id = :oid",
        {"id": session_id, "oid": claims["org_id"]},
    )
    if not row:
        _err(404, "session not found")
    return _ok(dict(row))


@router.post("/sessions", status_code=201)
async def start_session(request: Request, claims: dict = Depends(get_current_user),
                        db: Database = Depends(get_db)):
    body = await request.json()
    sid = new_id()
    await db.execute(
        "INSERT INTO sessions (id, survey_id, surveyor_id, respondent_ref, status, "
        "sync_source, location, device_info) "
        "VALUES (:id, :survey, :surveyor, :ref, 'IN_PROGRESS', :src, :loc, :dev)",
        {
            "id": sid,
            "survey": body.get("surveyId"),
            "surveyor": claims["sub"],
            "ref": body.get("respondentRef"),
            "src": body.get("syncSource") or "ONLINE",
            "loc": json.dumps(body.get("location") or {}),
            "dev": json.dumps(body.get("deviceInfo") or {}),
        },
    )
    row = await db.fetch_one("SELECT * FROM sessions WHERE id = :id", {"id": sid})
    return _ok(dict(row))


@router.patch("/sessions/{session_id}/complete")
async def complete_session(session_id: str, claims: dict = Depends(get_current_user),
                           db: Database = Depends(get_db)):
    row = await db.fetch_one(
        "SELECT s.id FROM sessions s JOIN surveys su ON su.id = s.survey_id "
        "WHERE s.id = :id AND su.org_id = :oid",
        {"id": session_id, "oid": claims["org_id"]},
    )
    if not row:
        _err(404, "session not found")
    await db.execute(
        "UPDATE sessions SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW() WHERE id = :id",
        {"id": session_id},
    )
    updated = await db.fetch_one("SELECT * FROM sessions WHERE id = :id", {"id": session_id})
    return _ok(dict(updated))


@router.patch("/sessions/{session_id}/abandon")
async def abandon_session(session_id: str, claims: dict = Depends(get_current_user),
                          db: Database = Depends(get_db)):
    row = await db.fetch_one(
        "SELECT s.id FROM sessions s JOIN surveys su ON su.id = s.survey_id "
        "WHERE s.id = :id AND su.org_id = :oid",
        {"id": session_id, "oid": claims["org_id"]},
    )
    if not row:
        _err(404, "session not found")
    await db.execute(
        "UPDATE sessions SET status = 'ABANDONED', updated_at = NOW() WHERE id = :id",
        {"id": session_id},
    )
    updated = await db.fetch_one("SELECT * FROM sessions WHERE id = :id", {"id": session_id})
    return _ok(dict(updated))


@router.post("/sync/batch")
async def batch_sync(request: Request, claims: dict = Depends(get_current_user),
                     db: Database = Depends(get_db)):
    body = await request.json()
    items: list = body.get("items") or []
    synced, failed = 0, 0

    for item in items:
        try:
            itype = item.get("type")
            data = item.get("data") or {}
            if itype == "session":
                await db.execute(
                    "INSERT IGNORE INTO sessions (id, survey_id, surveyor_id, respondent_ref, "
                    "status, sync_source, location, device_info) "
                    "VALUES (:id, :survey, :surveyor, :ref, 'IN_PROGRESS', 'OFFLINE', :loc, :dev)",
                    {
                        "id": data.get("id") or new_id(),
                        "survey": data.get("surveyId"),
                        "surveyor": claims["sub"],
                        "ref": data.get("respondentRef"),
                        "loc": json.dumps(data.get("location") or {}),
                        "dev": json.dumps(data.get("deviceInfo") or {}),
                    },
                )
            elif itype == "response":
                await db.execute(
                    "INSERT IGNORE INTO responses (id, session_id, question_id, type, "
                    "text_value, status) VALUES (:id, :sid, :qid, :type, :tv, 'SUBMITTED')",
                    {
                        "id": data.get("id") or new_id(),
                        "sid": data.get("sessionId"),
                        "qid": data.get("questionId"),
                        "type": data.get("type") or "SHORT_TEXT",
                        "tv": data.get("textValue"),
                    },
                )
            synced += 1
        except Exception:
            failed += 1

    return _ok({"synced": synced, "failed": failed})
