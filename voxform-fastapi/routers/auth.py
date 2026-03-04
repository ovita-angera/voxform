"""Auth routes — mirrors internal/handlers/auth.go."""

from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from databases import Database

import config
from auth_utils import (
    check_password, hash_password, hash_token, new_id, new_refresh_token,
    rand_hex, sign_access, slugify, verify_token,
)
from deps import get_current_user, get_db

router = APIRouter(tags=["auth"])

_ACCESS_TTL = config.JWT_ACCESS_TTL
_REFRESH_TTL = config.JWT_REFRESH_TTL


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ok(data: dict) -> dict:
    return {"success": True, "data": data}


def _err(status: int, msg: str):
    raise HTTPException(status_code=status, detail={"success": False, "message": msg})


def _is_not_found(exc: Exception) -> bool:
    return "no rows" in str(exc).lower() or str(exc) == "None"


async def _issue_tokens(response: Response, db: Database, user: dict) -> str:
    """Create access + refresh tokens. Set httpOnly cookie. Return access token."""
    access = sign_access(user["id"], user["email"], user["org_id"], user["role"])
    plain, hashed = new_refresh_token()

    expires = datetime.now(timezone.utc) + timedelta(seconds=_REFRESH_TTL)
    await db.execute(
        "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (:id, :uid, :h, :exp)",
        {"id": new_id(), "uid": user["id"], "h": hashed, "exp": expires},
    )

    response.set_cookie(
        key="vf_refresh",
        value=plain,
        httponly=True,
        samesite="lax",
        path="/api/v1/auth",
        max_age=_REFRESH_TTL,
        secure=False,
    )
    return access


async def _user_with_org(db: Database, user_id: str) -> dict:
    user = await db.fetch_one("SELECT * FROM users WHERE id = :id", {"id": user_id})
    if not user:
        return None
    org = await db.fetch_one("SELECT * FROM organizations WHERE id = :id", {"id": user["org_id"]})
    u = dict(user)
    u["org"] = dict(org) if org else {}
    return u


def _safe_user(user: dict) -> dict:
    """Strip sensitive fields."""
    skip = {"password_hash", "verify_token", "reset_token", "reset_expiry"}
    return {k: v for k, v in user.items() if k not in skip}


# ── Register ──────────────────────────────────────────────────────────────────

@router.post("/auth/register", status_code=201)
async def register(request: Request, response: Response, db: Database = Depends(get_db)):
    body = await request.json()
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    org_name = (body.get("orgName") or "").strip()

    if not name or not email or not password or not org_name:
        _err(400, "name, email, password and orgName are required")
    if len(password) < 8:
        _err(400, "password must be at least 8 characters")

    existing = await db.fetch_one("SELECT id FROM users WHERE email = :e", {"e": email})
    if existing:
        _err(409, "email already registered")

    org_id = new_id()
    slug = slugify(org_name) + "-" + rand_hex(3)
    await db.execute(
        "INSERT INTO organizations (id, name, slug, plan, settings) "
        "VALUES (:id, :name, :slug, 'FREE', '{}')",
        {"id": org_id, "name": org_name, "slug": slug},
    )

    user_id = new_id()
    verify_tok = rand_hex(16)
    pwd_hash = hash_password(password)
    await db.execute(
        "INSERT INTO users (id, org_id, role, name, email, password_hash, email_verified, "
        "verify_token, preferences) VALUES (:id, :oid, 'OWNER', :name, :email, :pwd, FALSE, :vt, '{}')",
        {"id": user_id, "oid": org_id, "name": name, "email": email, "pwd": pwd_hash, "vt": verify_tok},
    )
    await db.execute(
        "INSERT INTO org_members (id, org_id, user_id, role, joined_at) VALUES (:id, :oid, :uid, 'OWNER', NOW())",
        {"id": new_id(), "oid": org_id, "uid": user_id},
    )

    user = await _user_with_org(db, user_id)
    access = await _issue_tokens(response, db, user)
    return _ok({"user": _safe_user(user), "accessToken": access, "expiresIn": _ACCESS_TTL})


# ── Login ─────────────────────────────────────────────────────────────────────

@router.post("/auth/login")
async def login(request: Request, response: Response, db: Database = Depends(get_db)):
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""

    user = await db.fetch_one("SELECT * FROM users WHERE email = :e", {"e": email})
    if not user or not check_password(password, user["password_hash"]):
        _err(401, "Invalid credentials")

    full_user = await _user_with_org(db, user["id"])
    access = await _issue_tokens(response, db, full_user)
    return _ok({"user": _safe_user(full_user), "accessToken": access, "expiresIn": _ACCESS_TTL})


# ── Refresh ───────────────────────────────────────────────────────────────────

@router.post("/auth/refresh")
async def refresh(request: Request, response: Response, db: Database = Depends(get_db)):
    plain = request.cookies.get("vf_refresh", "")
    if not plain:
        _err(401, "no refresh token")

    hashed = hash_token(plain)
    row = await db.fetch_one(
        "SELECT * FROM refresh_tokens WHERE token_hash = :h AND expires_at > NOW()",
        {"h": hashed},
    )
    if not row:
        _err(401, "invalid or expired refresh token")

    # Rotate: delete old token
    await db.execute("DELETE FROM refresh_tokens WHERE id = :id", {"id": row["id"]})

    user = await _user_with_org(db, row["user_id"])
    if not user:
        _err(401, "user not found")

    access = await _issue_tokens(response, db, user)
    return _ok({"accessToken": access, "expiresIn": _ACCESS_TTL})


# ── Logout ────────────────────────────────────────────────────────────────────

@router.post("/auth/logout")
async def logout(request: Request, response: Response, db: Database = Depends(get_db)):
    plain = request.cookies.get("vf_refresh", "")
    if plain:
        hashed = hash_token(plain)
        await db.execute("DELETE FROM refresh_tokens WHERE token_hash = :h", {"h": hashed})
    response.delete_cookie("vf_refresh", path="/api/v1/auth")
    return {"success": True}


# ── Verify email ──────────────────────────────────────────────────────────────

@router.get("/auth/verify-email")
async def verify_email(token: str, db: Database = Depends(get_db)):
    user = await db.fetch_one("SELECT id FROM users WHERE verify_token = :t", {"t": token})
    if not user:
        _err(400, "invalid token")
    await db.execute(
        "UPDATE users SET email_verified = TRUE, verify_token = NULL WHERE id = :id",
        {"id": user["id"]},
    )
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=config.APP_URL + "/?verified=1")


# ── Forgot password ───────────────────────────────────────────────────────────

@router.post("/auth/forgot-password")
async def forgot_password(request: Request, db: Database = Depends(get_db)):
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    user = await db.fetch_one("SELECT id FROM users WHERE email = :e", {"e": email})
    if user:
        reset_tok = rand_hex(16)
        expiry = datetime.now(timezone.utc) + timedelta(hours=1)
        await db.execute(
            "UPDATE users SET reset_token = :t, reset_expiry = :exp WHERE id = :id",
            {"t": reset_tok, "exp": expiry, "id": user["id"]},
        )
        import logging
        logging.getLogger("auth").info(
            "password reset link: %s/reset-password?token=%s",
            config.APP_URL, reset_tok,
        )
    # Always 200 — don't leak user existence
    return _ok({"message": "if that email exists, a reset link has been sent"})


# ── Reset password ────────────────────────────────────────────────────────────

@router.post("/auth/reset-password")
async def reset_password(request: Request, db: Database = Depends(get_db)):
    body = await request.json()
    token = body.get("token") or ""
    password = body.get("password") or ""
    if len(password) < 8:
        _err(400, "password must be at least 8 characters")

    user = await db.fetch_one(
        "SELECT id FROM users WHERE reset_token = :t AND reset_expiry > NOW()",
        {"t": token},
    )
    if not user:
        _err(400, "invalid or expired reset token")

    pwd_hash = hash_password(password)
    await db.execute(
        "UPDATE users SET password_hash = :h, reset_token = NULL, reset_expiry = NULL WHERE id = :id",
        {"h": pwd_hash, "id": user["id"]},
    )
    # Force re-login everywhere
    await db.execute("DELETE FROM refresh_tokens WHERE user_id = :id", {"id": user["id"]})
    return _ok({"message": "password reset successfully"})


# ── Me (auth/me) ──────────────────────────────────────────────────────────────

@router.get("/auth/me")
async def me(claims: dict = Depends(get_current_user), db: Database = Depends(get_db)):
    user = await _user_with_org(db, claims["sub"])
    if not user:
        _err(404, "user not found")
    return _ok(_safe_user(user))
