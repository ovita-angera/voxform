"""Survey routes — mirrors internal/handlers/survey.go."""

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from databases import Database

from auth_utils import new_id, rand_hex, slugify
from deps import get_current_user, get_db

router = APIRouter(tags=["surveys"])

PLAN_MAX = {"FREE": 3, "STARTER": 10, "PRO": 9999, "BUSINESS": 9999, "ENTERPRISE": 9999}

DEFAULT_CONFIG = json.dumps({"allowBack": True, "showProgress": True})
DEFAULT_QC = json.dumps({"minDurationSec": 15, "maxSilenceRatio": 0.7})


def _ok(data):
    return {"success": True, "data": data}


def _err(status: int, msg: str):
    raise HTTPException(status_code=status, detail={"success": False, "message": msg})


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("/surveys")
async def list_surveys(
    page: int = 1, pageSize: int = 20, status: str = "", search: str = "",
    claims: dict = Depends(get_current_user), db: Database = Depends(get_db),
):
    where = ["org_id = :oid"]
    vals: dict = {"oid": claims["org_id"]}
    if status:
        where.append("status = :status"); vals["status"] = status
    if search:
        where.append("title LIKE :q"); vals["q"] = f"%{search}%"

    w = " AND ".join(where)
    total = (await db.fetch_one(f"SELECT COUNT(*) AS n FROM surveys WHERE {w}", vals))["n"]
    offset = (page - 1) * pageSize
    vals.update({"limit": pageSize, "offset": offset})
    rows = await db.fetch_all(
        f"SELECT * FROM surveys WHERE {w} ORDER BY created_at DESC LIMIT :limit OFFSET :offset", vals
    )
    return _ok({"data": [dict(r) for r in rows], "meta": {"total": total, "page": page, "pageSize": pageSize}})


# ── Get ───────────────────────────────────────────────────────────────────────

@router.get("/surveys/{survey_id}")
async def get_survey(survey_id: str, claims: dict = Depends(get_current_user),
                     db: Database = Depends(get_db)):
    row = await db.fetch_one(
        "SELECT * FROM surveys WHERE id = :id AND org_id = :oid",
        {"id": survey_id, "oid": claims["org_id"]},
    )
    if not row:
        _err(404, "survey not found")
    return _ok(dict(row))


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("/surveys", status_code=201)
async def create_survey(request: Request, claims: dict = Depends(get_current_user),
                        db: Database = Depends(get_db)):
    body = await request.json()

    # Check plan limit
    org = await db.fetch_one("SELECT plan FROM organizations WHERE id = :id", {"id": claims["org_id"]})
    plan = (org["plan"] if org else "FREE")
    count = (await db.fetch_one(
        "SELECT COUNT(*) AS n FROM surveys WHERE org_id = :oid", {"oid": claims["org_id"]}
    ))["n"]
    if count >= PLAN_MAX.get(plan, 3):
        _err(403, f"survey limit reached for {plan} plan")

    sid = new_id()
    title = body.get("title") or "Untitled survey"
    slug = slugify(title) + "-" + rand_hex(4)
    cfg = json.dumps(body["config"]) if "config" in body else DEFAULT_CONFIG
    qc = json.dumps(body["qcStandards"]) if "qcStandards" in body else DEFAULT_QC
    quota = body.get("quota")
    desc = body.get("description")

    await db.execute(
        "INSERT INTO surveys (id, org_id, owner_id, title, description, slug, status, config, "
        "qc_standards, quota) VALUES (:id, :oid, :uid, :title, :desc, :slug, 'DRAFT', :cfg, :qc, :quota)",
        {"id": sid, "oid": claims["org_id"], "uid": claims["sub"], "title": title,
         "desc": desc, "slug": slug, "cfg": cfg, "qc": qc, "quota": quota},
    )
    row = await db.fetch_one("SELECT * FROM surveys WHERE id = :id", {"id": sid})
    return _ok(dict(row))


# ── Update ────────────────────────────────────────────────────────────────────

@router.put("/surveys/{survey_id}")
async def update_survey(survey_id: str, request: Request,
                        claims: dict = Depends(get_current_user), db: Database = Depends(get_db)):
    row = await db.fetch_one(
        "SELECT * FROM surveys WHERE id = :id AND org_id = :oid",
        {"id": survey_id, "oid": claims["org_id"]},
    )
    if not row:
        _err(404, "survey not found")

    body = await request.json()
    sets, vals = [], {"id": survey_id}
    if "title" in body:
        sets.append("title = :title"); vals["title"] = body["title"]
    if "description" in body:
        sets.append("description = :desc"); vals["desc"] = body["description"]
    if "config" in body:
        sets.append("config = :cfg"); vals["cfg"] = json.dumps(body["config"])
    if "qcStandards" in body:
        sets.append("qc_standards = :qc"); vals["qc"] = json.dumps(body["qcStandards"])
    if "quota" in body:
        sets.append("quota = :quota"); vals["quota"] = body["quota"]

    if sets:
        await db.execute(
            f"UPDATE surveys SET {', '.join(sets)}, updated_at = NOW() WHERE id = :id", vals
        )

    # Save version snapshot
    current = await db.fetch_one("SELECT * FROM surveys WHERE id = :id", {"id": survey_id})
    ver_num = (await db.fetch_one(
        "SELECT COALESCE(MAX(version), 0) + 1 AS v FROM survey_versions WHERE survey_id = :id",
        {"id": survey_id},
    ))["v"]
    await db.execute(
        "INSERT INTO survey_versions (id, survey_id, version, snapshot, created_by) "
        "VALUES (:id, :sid, :v, :snap, :uid)",
        {"id": new_id(), "sid": survey_id, "v": ver_num,
         "snap": json.dumps(dict(current)), "uid": claims["sub"]},
    )
    return _ok(dict(current))


# ── Update status ─────────────────────────────────────────────────────────────

@router.patch("/surveys/{survey_id}/status")
async def update_status(survey_id: str, request: Request,
                        claims: dict = Depends(get_current_user), db: Database = Depends(get_db)):
    body = await request.json()
    status = (body.get("status") or "").upper()
    if status not in ("ACTIVE", "PAUSED", "DRAFT", "CLOSED", "ARCHIVED"):
        _err(400, "invalid status")

    row = await db.fetch_one(
        "SELECT id FROM surveys WHERE id = :id AND org_id = :oid",
        {"id": survey_id, "oid": claims["org_id"]},
    )
    if not row:
        _err(404, "survey not found")

    await db.execute(
        "UPDATE surveys SET status = :s, updated_at = NOW() WHERE id = :id",
        {"s": status, "id": survey_id},
    )
    updated = await db.fetch_one("SELECT * FROM surveys WHERE id = :id", {"id": survey_id})
    return _ok(dict(updated))


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/surveys/{survey_id}", status_code=204)
async def delete_survey(survey_id: str, claims: dict = Depends(get_current_user),
                        db: Database = Depends(get_db)):
    row = await db.fetch_one(
        "SELECT id FROM surveys WHERE id = :id AND org_id = :oid",
        {"id": survey_id, "oid": claims["org_id"]},
    )
    if not row:
        _err(404, "survey not found")
    await db.execute("DELETE FROM surveys WHERE id = :id", {"id": survey_id})


# ── Duplicate ─────────────────────────────────────────────────────────────────

@router.post("/surveys/{survey_id}/duplicate", status_code=201)
async def duplicate_survey(survey_id: str, claims: dict = Depends(get_current_user),
                            db: Database = Depends(get_db)):
    original = await db.fetch_one(
        "SELECT * FROM surveys WHERE id = :id AND org_id = :oid",
        {"id": survey_id, "oid": claims["org_id"]},
    )
    if not original:
        _err(404, "survey not found")

    new_sid = new_id()
    new_title = (original["title"] or "") + " (copy)"
    new_slug = slugify(original["slug"] or "") + "-copy-" + rand_hex(3)

    await db.execute(
        "INSERT INTO surveys (id, org_id, owner_id, title, description, slug, status, config, "
        "qc_standards, quota) VALUES (:id, :oid, :uid, :title, :desc, :slug, 'DRAFT', :cfg, :qc, :quota)",
        {"id": new_sid, "oid": claims["org_id"], "uid": claims["sub"],
         "title": new_title, "desc": original["description"],
         "slug": new_slug, "cfg": original["config"] or DEFAULT_CONFIG,
         "qc": original["qc_standards"] or DEFAULT_QC, "quota": original["quota"]},
    )

    # Copy questions with new IDs
    questions = await db.fetch_all(
        "SELECT * FROM questions WHERE survey_id = :sid ORDER BY order_index ASC",
        {"sid": survey_id},
    )
    for q in questions:
        await db.execute(
            "INSERT INTO questions (id, survey_id, type, title, description, required, "
            "order_index, options, logic, audio_prompt_url) "
            "VALUES (:id, :sid, :type, :title, :desc, :req, :ord, :opts, :logic, :apu)",
            {"id": new_id(), "sid": new_sid, "type": q["type"], "title": q["title"],
             "desc": q["description"], "req": q["required"], "ord": q["order_index"],
             "opts": q["options"] or "{}", "logic": q["logic"] or "[]",
             "apu": q["audio_prompt_url"]},
        )

    row = await db.fetch_one("SELECT * FROM surveys WHERE id = :id", {"id": new_sid})
    return _ok(dict(row))


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/surveys/{survey_id}/stats")
async def stats(survey_id: str, claims: dict = Depends(get_current_user),
                db: Database = Depends(get_db)):
    row = await db.fetch_one(
        "SELECT id FROM surveys WHERE id = :id AND org_id = :oid",
        {"id": survey_id, "oid": claims["org_id"]},
    )
    if not row:
        _err(404, "survey not found")

    s = await db.fetch_one(
        "SELECT COUNT(DISTINCT s.id) AS response_count, "
        "COUNT(DISTINCT CASE WHEN s.status = 'COMPLETED' THEN s.id END) AS completed_count, "
        "AVG(r.audio_duration_sec) AS avg_duration_sec "
        "FROM sessions s LEFT JOIN responses r ON r.session_id = s.id "
        "WHERE s.survey_id = :sid",
        {"sid": survey_id},
    )
    return _ok(dict(s))


# ── Versions ──────────────────────────────────────────────────────────────────

@router.get("/surveys/{survey_id}/versions")
async def versions(survey_id: str, claims: dict = Depends(get_current_user),
                   db: Database = Depends(get_db)):
    row = await db.fetch_one(
        "SELECT id FROM surveys WHERE id = :id AND org_id = :oid",
        {"id": survey_id, "oid": claims["org_id"]},
    )
    if not row:
        _err(404, "survey not found")

    rows = await db.fetch_all(
        "SELECT id, version, created_by, created_at FROM survey_versions "
        "WHERE survey_id = :sid ORDER BY version DESC",
        {"sid": survey_id},
    )
    return _ok([dict(r) for r in rows])
