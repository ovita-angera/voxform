import glob
import os

from databases import Database

import config

db: Database = Database(config.DSN)


async def connect() -> None:
    await db.connect()


async def disconnect() -> None:
    await db.disconnect()


async def run_migrations() -> None:
    """Execute *.up.sql migration files in filename order (idempotent via IF NOT EXISTS)."""
    path = os.path.abspath(config.MIGRATIONS_PATH)
    files = sorted(glob.glob(os.path.join(path, "*.up.sql")))
    for filepath in files:
        with open(filepath, "r", encoding="utf-8") as f:
            sql = f.read()
        # Split on semicolons to execute statement-by-statement
        statements = [s.strip() for s in sql.split(";") if s.strip()]
        for stmt in statements:
            try:
                await db.execute(stmt)
            except Exception as exc:
                # Skip "table already exists" and similar harmless errors
                msg = str(exc).lower()
                if "already exists" in msg or "duplicate" in msg:
                    continue
                raise
