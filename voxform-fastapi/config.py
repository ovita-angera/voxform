import os
import re
from dotenv import load_dotenv

# Load .env.local from the Go backend directory (reuse same config file)
_here = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_here, "..", "voxform-go", ".env.local"))


def _env(key: str, fallback: str = "") -> str:
    return os.environ.get(key, fallback) or fallback


def _duration_seconds(val: str, fallback: int) -> int:
    """Parse Go-style duration string like '15m' or '168h' into seconds."""
    if not val:
        return fallback
    m = re.fullmatch(r"(\d+)(s|m|h)", val.strip())
    if not m:
        return fallback
    n, unit = int(m.group(1)), m.group(2)
    return n * {"s": 1, "m": 60, "h": 3600}[unit]


def _convert_dsn(go_dsn: str) -> str:
    """Convert Go MySQL DSN to SQLAlchemy/databases URL.

    Go:     root:pass@tcp(127.0.0.1:3306)/voxform?parseTime=true&charset=utf8mb4
    Python: mysql+aiomysql://root:pass@127.0.0.1:3306/voxform
    """
    m = re.match(r"([^:]*):([^@]*)@tcp\(([^)]+)\)/([^?]*)", go_dsn)
    if not m:
        return go_dsn  # already in URL form
    user, password, host, dbname = m.group(1), m.group(2), m.group(3), m.group(4)
    return f"mysql+aiomysql://{user}:{password}@{host}/{dbname}"


PORT: str = _env("PORT", "4000")
APP_URL: str = _env("APP_URL", "http://localhost:3000")
CORS_ORIGINS: list[str] = _env("CORS_ORIGINS", "http://localhost:3000").split(",")
DSN: str = _convert_dsn(_env("DATABASE_DSN",
    "root:@tcp(127.0.0.1:3306)/voxform?parseTime=true&charset=utf8mb4"))
MIGRATIONS_PATH: str = _env("MIGRATIONS_PATH",
    os.path.join(_here, "..", "voxform-go", "migrations"))
JWT_SECRET: str = _env("JWT_SECRET", "change-me")
JWT_ACCESS_TTL: int = _duration_seconds(_env("JWT_ACCESS_TTL", "15m"), 900)
JWT_REFRESH_TTL: int = _duration_seconds(_env("JWT_REFRESH_TTL", "168h"), 604800)
STORAGE_PATH: str = _env("STORAGE_PATH", os.path.join(_here, "..", "voxform-go", "storage"))
STORAGE_URL: str = _env("STORAGE_URL", "http://localhost:4000/storage")
GROQ_API_KEY: str = _env("GROQ_API_KEY", "")
ANTHROPIC_API_KEY: str = _env("ANTHROPIC_API_KEY", "")
