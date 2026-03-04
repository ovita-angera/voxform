# ── Stage 1: Python deps ──────────────────────────────────────────────────────
FROM python:3.12-slim AS deps

WORKDIR /app

# ffmpeg for audio conversion (WAV 16kHz pipeline)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY voxform-fastapi/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Stage 2: App ──────────────────────────────────────────────────────────────
FROM python:3.12-slim AS app

WORKDIR /app

# Copy ffmpeg binary + shared libs from deps stage
COPY --from=deps /usr/bin/ffmpeg /usr/bin/ffmpeg
COPY --from=deps /usr/lib /usr/lib
COPY --from=deps /lib /lib

# Copy installed Python packages
COPY --from=deps /usr/local/lib/python3.12 /usr/local/lib/python3.12
COPY --from=deps /usr/local/bin /usr/local/bin

# Copy application code
COPY voxform-fastapi/ .

# Default storage directory (Railway persistent volume mounts here)
RUN mkdir -p /app/storage/audio/raw

# Railway injects PORT; fall back to 4000 for local docker run
ENV PORT=4000
EXPOSE 4000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
