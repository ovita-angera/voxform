import glob
import os
from urllib.parse import urlparse

import aiomysql
from databases import Database

import config

db: Database = Database(config.DSN)


async def connect() -> None:
    await db.connect()


async def disconnect() -> None:
    await db.disconnect()


async def run_migrations() -> None:
    """Execute *.up.sql migration files in filename order (idempotent via IF NOT EXISTS).

    Uses a raw aiomysql connection instead of SQLAlchemy text() so that JSON
    literals like '{"key":true}' are not misread as named bind parameters.
    """
    path = os.path.abspath(config.MIGRATIONS_PATH)
    files = sorted(glob.glob(os.path.join(path, "*.up.sql")))
    if not files:
        return

    # Parse DSN: mysql+aiomysql://user:pass@host:port/dbname
    parsed = urlparse(config.DSN.replace("mysql+aiomysql://", "mysql://", 1))
    conn = await aiomysql.connect(
        host=parsed.hostname or "127.0.0.1",
        port=parsed.port or 3306,
        user=parsed.username or "root",
        password=parsed.password or "",
        db=(parsed.path or "/voxform").lstrip("/"),
        charset="utf8mb4",
        autocommit=True,
    )
    try:
        for filepath in files:
            with open(filepath, encoding="utf-8") as f:
                sql = f.read()
            for stmt in (s.strip() for s in sql.split(";") if s.strip()):
                try:
                    async with conn.cursor() as cur:
                        await cur.execute(stmt)
                except Exception as exc:
                    msg = str(exc).lower()
                    if any(k in msg for k in ("already exists", "duplicate", "1050", "1062")):
                        continue
                    raise
    finally:
        conn.close()
