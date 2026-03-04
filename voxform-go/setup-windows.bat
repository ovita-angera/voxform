@echo off
echo.
echo ============================================
echo  VOXFORM Go API — Windows Setup
echo ============================================
echo.

:: Check Go
where go >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Go not found. Download from https://go.dev/dl/
    exit /b 1
)

echo Go version:
go version
echo.

echo [1/4] Creating storage directories...
if not exist "storage\audio\raw"     mkdir "storage\audio\raw"
if not exist "storage\audio\mp3"     mkdir "storage\audio\mp3"
if not exist "storage\uploads\photos" mkdir "storage\uploads\photos"
echo Done.

echo.
echo [2/4] Downloading Go dependencies...
go mod download
if %errorlevel% neq 0 ( echo FAILED & exit /b 1 )

echo.
echo [3/4] Verifying build...
go build ./...
if %errorlevel% neq 0 ( echo BUILD FAILED — check errors above & exit /b 1 )
echo Build OK.

echo.
echo [4/4] Checking env file...
if not exist ".env.local" (
    echo .env.local not found — creating from template...
    copy .env.local.example .env.local >nul 2>&1
    echo.
    echo !! IMPORTANT: Edit .env.local and set:
    echo    JWT_SECRET  — run: go run ./cmd/genkey
    echo    DATABASE_DSN — verify XAMPP MySQL is running
)

echo.
echo ============================================
echo  SETUP COMPLETE
echo ============================================
echo.
echo  Prerequisites:
echo    1. Start XAMPP MySQL
echo    2. Create database: CREATE DATABASE voxform;
echo       (http://localhost/phpmyadmin)
echo.
echo  Start the API:
echo    go run ./cmd/api
echo.
echo  The API will auto-run migrations and seed demo data on first start.
echo.
echo  API:     http://localhost:4000/api/v1
echo  Storage: http://localhost:4000/storage
echo.
echo  Demo login:
echo    admin@nri.ac.ke     / voxform123
echo    surveyor@nri.ac.ke  / voxform123
echo.
