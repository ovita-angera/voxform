FROM python:3.12-slim

WORKDIR /app

# ffmpeg for audio conversion (WAV 16kHz pipeline)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY voxform-fastapi/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY voxform-fastapi/ .

# Copy DB migrations (SQL files — Go source excluded, migrations kept)
COPY voxform-go/migrations ./migrations

# Storage dir (ephemeral on Render free tier, persistent on paid + Render Disk)
RUN mkdir -p /tmp/storage/audio/raw

ENV PORT=4000
ENV MIGRATIONS_PATH=/app/migrations
ENV STORAGE_PATH=/tmp/storage

EXPOSE 4000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
