from fastapi import Depends, HTTPException, Request
from jose import JWTError

import database
from auth_utils import verify_token


def get_db():
    return database.db


async def get_current_user(request: Request) -> dict:
    """FastAPI dependency — mirrors Go's middleware.Authenticate."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail={"success": False, "message": "unauthorized"})
    token = auth.removeprefix("Bearer ").strip()
    try:
        claims = verify_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail={"success": False, "message": "unauthorized"})
    return claims
