# Voxform — Go API

Audio-native survey platform backend. **15 files, 4 dependencies, zero infrastructure.**

## Why Go instead of NestJS

| | NestJS (before) | Go (now) |
|---|---|---|
| Files | ~100 | **15** |
| Dependencies | 600+ npm packages | **4 Go packages** |
| Startup | 8–10s | **~50ms** |
| RAM idle | ~180MB | **~18MB** |
| Queue | Redis + BullMQ | **Goroutine channel** |
| Build | TypeScript watch | `go build` — 2s |
| Deploy | Node runtime required | **Single binary** |

## Stack

- **[Chi](https://github.com/go-chi/chi)** — lightweight HTTP router (similar to Express)
- **[sqlx](https://github.com/jmoiron/sqlx)** — thin wrapper over `database/sql`, reads like raw SQL
- **[golang-jwt](https://github.com/golang-jwt/jwt)** — JWT sign/verify
- **[zerolog](https://github.com/rs/zerolog)** — structured JSON logging
- **MySQL (XAMPP)** — your existing database
- **Local filesystem** — audio files in `storage/`
- **Goroutine queue** — audio processing, no Redis needed

## Project structure

```
api/
├── cmd/api/
│   ├── main.go        ← 130 lines: bootstrap, router, server
│   └── config.go      ← 40 lines: env var config
├── internal/
│   ├── auth/jwt.go    ← JWT sign/verify/refresh tokens
│   ├── db/db.go       ← MySQL pool + migrations
│   ├── middleware/    ← JWT auth guard + request logger
│   ├── models/        ← structs + SQL query functions
│   ├── handlers/      ← one file per domain (auth, surveys, audio…)
│   └── queue/         ← goroutine worker + audio pipeline
├── migrations/        ← plain .sql files, versioned
├── storage/           ← local audio files (git-ignored)
├── .env.local         ← config (git-ignored)
└── Makefile
```

## First-time setup (Windows + XAMPP)

```batch
:: 1. Create the database
::    Open http://localhost/phpmyadmin → New → voxform

:: 2. Run setup
setup-windows.bat

:: 3. Edit .env.local
::    Set JWT_SECRET (see instructions in file)

:: 4. Start
go run ./cmd/api
```

Migrations and seed data run **automatically** on first start.

## Development

```bash
go run ./cmd/api          # start (auto-migrates on start)
go build -o bin/voxform ./cmd/api  # compile
go build ./...            # verify no errors
```

For hot reload, install [Air](https://github.com/air-verse/air):
```bash
go install github.com/air-verse/air@latest
air
```

## .env.local reference

```env
PORT=4000
DATABASE_DSN=root:@tcp(127.0.0.1:3306)/voxform?parseTime=true&charset=utf8mb4
JWT_SECRET=<openssl rand -hex 64>
GROQ_API_KEY=          # free at console.groq.com — optional
ANTHROPIC_API_KEY=     # optional — skip during dev
```

## API endpoints

All protected routes require `Authorization: Bearer <token>`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/register` | Register + create org |
| POST | `/api/v1/auth/login` | Login → access + refresh tokens |
| POST | `/api/v1/auth/refresh` | Rotate tokens via httpOnly cookie |
| POST | `/api/v1/auth/logout` | Revoke refresh token |
| GET | `/api/v1/auth/me` | Current user |
| GET | `/api/v1/surveys` | List surveys |
| POST | `/api/v1/surveys` | Create survey |
| PUT | `/api/v1/surveys/:id` | Update survey |
| PATCH | `/api/v1/surveys/:id/status` | Publish / pause |
| GET | `/api/v1/surveys/:surveyId/questions` | List questions |
| POST | `/api/v1/surveys/:surveyId/questions` | Add question |
| PUT | `/api/v1/surveys/:surveyId/questions/:id` | Update question |
| POST | `/api/v1/surveys/:surveyId/questions/reorder` | Reorder |
| POST | `/api/v1/sessions` | Start survey session |
| PATCH | `/api/v1/sessions/:id/complete` | Mark complete |
| POST | `/api/v1/responses` | Submit a response |
| POST | `/api/v1/audio/upload-slot` | Get upload URL |
| POST | `/api/v1/audio/upload/:uploadId` | Upload audio file |
| GET | `/api/v1/audio/job/:responseId` | Poll job status |
| GET | `/api/v1/public/surveys/:slug` | Public survey player |

## Audio pipeline

```
Browser → POST /audio/upload/:id (multipart)
        → saved to storage/audio/raw/
        → queue.Enqueue("audio:process", {responseId})
        → goroutine worker picks up job
        → ffmpeg: .webm → .wav 16kHz mono (if ffmpeg installed)
        → Groq Whisper API (if GROQ_API_KEY set)
        → Claude extraction (if ANTHROPIC_API_KEY set)
        → audio_jobs.status = "COMPLETE"
```

If ffmpeg isn't installed, the original file is used as-is. If Groq key is absent, transcription is skipped. Everything degrades gracefully.

## Deploying (when ready)

The entire API is a single binary:

```bash
# Build for Linux server from Windows
set GOOS=linux
set GOARCH=amd64
go build -o voxform-linux ./cmd/api

# SCP to server, set env vars, run
./voxform-linux
```

For the database: swap `DATABASE_DSN` to point at PlanetScale, Railway MySQL, or any MySQL 8+ instance.
