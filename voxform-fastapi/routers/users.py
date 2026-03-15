"""User routes — mirrors internal/handlers/user.go."""

from fastapi import APIRouter, Depends, Request
from databases import Database

from auth_utils import new_id
from deps import get_current_user, get_db

router = APIRouter(tags=["users"])


def _ok(data):
    return {"success": True, "data": data}


def _safe(row: dict) -> dict:
    skip = {"password_hash", "verify_token", "reset_token", "reset_expiry"}
    return {k: v for k, v in row.items() if k not in skip}


async def _with_org(db: Database, user_id: str) -> dict:
    user = await db.fetch_one("SELECT * FROM users WHERE id = :id", {"id": user_id})
    if not user:
        return None
    org = await db.fetch_one("SELECT * FROM organizations WHERE id = :id", {"id": user["org_id"]})
    u = dict(user)
    u["org"] = dict(org) if org else {}
    return u


@router.get("/users/me")
async def me(claims: dict = Depends(get_current_user), db: Database = Depends(get_db)):
    user = await _with_org(db, claims["sub"])
    if not user:
        from fastapi import HTTPException
        raise HTTPException(404, detail={"success": False, "message": "not found"})
    return _ok(_safe(user))


@router.put("/users/me")
async def update(request: Request, claims: dict = Depends(get_current_user),
                 db: Database = Depends(get_db)):
    body = await request.json()
    import json

    sets, vals = [], {"id": claims["sub"]}
    if "name" in body:
        sets.append("name = :name"); vals["name"] = body["name"]
    if "avatarUrl" in body:
        sets.append("avatar_url = :avatar"); vals["avatar"] = body["avatarUrl"]
    if "preferences" in body:
        sets.append("preferences = :prefs"); vals["prefs"] = json.dumps(body["preferences"])

    if sets:
        await db.execute(
            f"UPDATE users SET {', '.join(sets)}, updated_at = NOW() WHERE id = :id", vals
        )
    user = await _with_org(db, claims["sub"])
    return _ok(_safe(user))


@router.put("/orgs/plan")
async def update_plan(request: Request, claims: dict = Depends(get_current_user),
                      db: Database = Depends(get_db)):
    body = await request.json()
    plan = (body.get("plan") or "").upper()
    if plan not in ("FREE", "STARTER", "PRO", "BUSINESS", "ENTERPRISE"):
        from fastapi import HTTPException
        raise HTTPException(400, detail={"success": False, "message": "plan must be FREE, STARTER, PRO, BUSINESS, or ENTERPRISE"})
    await db.execute(
        "UPDATE organizations SET plan = :plan, updated_at = NOW() WHERE id = :oid",
        {"plan": plan, "oid": claims["org_id"]},
    )
    org = await db.fetch_one("SELECT * FROM organizations WHERE id = :id", {"id": claims["org_id"]})
    return _ok(dict(org) if org else {})


@router.get("/users/org/members")
async def org_members(claims: dict = Depends(get_current_user), db: Database = Depends(get_db)):
    rows = await db.fetch_all(
        "SELECT u.id, u.name, u.email, u.avatar_url, u.role, m.role AS member_role, m.joined_at "
        "FROM org_members m JOIN users u ON u.id = m.user_id "
        "WHERE m.org_id = :oid",
        {"oid": claims["org_id"]},
    )
    return _ok([dict(r) for r in rows])
