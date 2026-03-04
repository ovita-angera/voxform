"""Question routes — mirrors internal/handlers/question.go."""

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from databases import Database

from auth_utils import new_id
from deps import get_current_user, get_db

router = APIRouter(tags=["questions"])


def _ok(data):
    return {"success": True, "data": data}


def _err(status: int, msg: str):
    raise HTTPException(status_code=status, detail={"success": False, "message": msg})


async def _assert_survey(db: Database, survey_id: str, org_id: str) -> bool:
    row = await db.fetch_one(
        "SELECT id FROM surveys WHERE id = :id AND org_id = :oid",
        {"id": survey_id, "oid": org_id},
    )
    return row is not None


@router.get("/surveys/{survey_id}/questions")
async def list_questions(survey_id: str, claims: dict = Depends(get_current_user),
                         db: Database = Depends(get_db)):
    if not await _assert_survey(db, survey_id, claims["org_id"]):
        _err(404, "survey not found")
    rows = await db.fetch_all(
        "SELECT * FROM questions WHERE survey_id = :sid ORDER BY order_index ASC",
        {"sid": survey_id},
    )
    return _ok([dict(r) for r in rows])


@router.post("/surveys/{survey_id}/questions", status_code=201)
async def create_question(survey_id: str, request: Request,
                          claims: dict = Depends(get_current_user), db: Database = Depends(get_db)):
    if not await _assert_survey(db, survey_id, claims["org_id"]):
        _err(404, "survey not found")

    body = await request.json()
    max_ord = await db.fetch_one(
        "SELECT COALESCE(MAX(order_index), -1) + 1 AS next FROM questions WHERE survey_id = :sid",
        {"sid": survey_id},
    )
    qid = new_id()
    await db.execute(
        "INSERT INTO questions (id, survey_id, type, title, description, required, order_index, "
        "options, logic) VALUES (:id, :sid, :type, :title, :desc, :req, :ord, :opts, :logic)",
        {
            "id": qid, "sid": survey_id,
            "type": body.get("type") or "SHORT_TEXT",
            "title": body.get("title") or "Untitled question",
            "desc": body.get("description"),
            "req": bool(body.get("required", False)),
            "ord": max_ord["next"],
            "opts": json.dumps(body.get("options") or {}),
            "logic": json.dumps(body.get("logic") or []),
        },
    )
    row = await db.fetch_one("SELECT * FROM questions WHERE id = :id", {"id": qid})
    return _ok(dict(row))


@router.put("/surveys/{survey_id}/questions/{question_id}")
async def update_question(survey_id: str, question_id: str, request: Request,
                          claims: dict = Depends(get_current_user), db: Database = Depends(get_db)):
    if not await _assert_survey(db, survey_id, claims["org_id"]):
        _err(404, "survey not found")

    body = await request.json()
    sets, vals = [], {"id": question_id, "sid": survey_id}
    if "title" in body:
        sets.append("title = :title"); vals["title"] = body["title"]
    if "description" in body:
        sets.append("description = :desc"); vals["desc"] = body["description"]
    if "required" in body:
        sets.append("required = :req"); vals["req"] = bool(body["required"])
    if "options" in body:
        sets.append("options = :opts"); vals["opts"] = json.dumps(body["options"])
    if "logic" in body:
        sets.append("logic = :logic"); vals["logic"] = json.dumps(body["logic"])
    if "order" in body:
        sets.append("order_index = :ord"); vals["ord"] = int(body["order"])

    if sets:
        await db.execute(
            f"UPDATE questions SET {', '.join(sets)}, updated_at = NOW() "
            "WHERE id = :id AND survey_id = :sid", vals
        )
    row = await db.fetch_one("SELECT * FROM questions WHERE id = :id", {"id": question_id})
    if not row:
        _err(404, "question not found")
    return _ok(dict(row))


@router.post("/surveys/{survey_id}/questions/reorder")
async def reorder_questions(survey_id: str, request: Request,
                             claims: dict = Depends(get_current_user), db: Database = Depends(get_db)):
    if not await _assert_survey(db, survey_id, claims["org_id"]):
        _err(404, "survey not found")

    body = await request.json()
    ids: list = body.get("ids") or []
    for i, qid in enumerate(ids):
        await db.execute(
            "UPDATE questions SET order_index = :ord WHERE id = :id AND survey_id = :sid",
            {"ord": i, "id": qid, "sid": survey_id},
        )
    return _ok({"reordered": len(ids)})


@router.delete("/surveys/{survey_id}/questions/{question_id}", status_code=204)
async def delete_question(survey_id: str, question_id: str,
                          claims: dict = Depends(get_current_user), db: Database = Depends(get_db)):
    if not await _assert_survey(db, survey_id, claims["org_id"]):
        _err(404, "survey not found")
    await db.execute(
        "DELETE FROM questions WHERE id = :id AND survey_id = :sid",
        {"id": question_id, "sid": survey_id},
    )
