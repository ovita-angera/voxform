import hashlib
import os
import re
import secrets
from datetime import datetime, timezone, timedelta

import bcrypt as _bcrypt
from jose import JWTError, jwt

import config

ISSUER = "voxform"
ALGORITHM = "HS256"

_ROUNDS = 12


# ── Passwords ─────────────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return _bcrypt.hashpw(plain.encode(), _bcrypt.gensalt(rounds=_ROUNDS)).decode()


def check_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


# ── JWT ───────────────────────────────────────────────────────────────────────

def sign_access(user_id: str, email: str, org_id: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    claims = {
        "sub": user_id,
        "email": email,
        "org_id": org_id,
        "role": role,
        "iss": ISSUER,
        "iat": now,
        "exp": now + timedelta(seconds=config.JWT_ACCESS_TTL),
    }
    return jwt.encode(claims, config.JWT_SECRET, algorithm=ALGORITHM)


def verify_token(token: str) -> dict:
    """Decode and verify a JWT. Returns the claims dict or raises JWTError."""
    return jwt.decode(token, config.JWT_SECRET, algorithms=[ALGORITHM],
                      options={"verify_iss": True}, issuer=ISSUER)


# ── Refresh tokens ────────────────────────────────────────────────────────────

def new_refresh_token() -> tuple[str, str]:
    """Return (plain_token, sha256_hash). Store only the hash in DB."""
    token = secrets.token_hex(20)   # 40 hex chars, matches Go randHex(20)
    hashed = hashlib.sha256(token.encode()).hexdigest()
    return token, hashed


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ── ID generation ─────────────────────────────────────────────────────────────

def new_id() -> str:
    """24-char hex ID (12 random bytes), matches Go newID()."""
    return os.urandom(12).hex()


def rand_hex(n: int) -> str:
    return os.urandom(n).hex()


# ── Slug ──────────────────────────────────────────────────────────────────────

def slugify(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = s.strip("-")
    return s[:60]
