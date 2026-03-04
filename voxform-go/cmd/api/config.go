package main

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port           string
	AppURL         string
	CORSOrigins    []string
	DSN            string        // mysql://user:pass@host:port/db
	MigrationsPath string
	JWTSecret      string
	JWTAccessTTL   time.Duration
	JWTRefreshTTL  time.Duration
	StoragePath    string
	StorageURL     string
	GroqAPIKey     string
	AnthropicKey   string
}

func loadConfig() Config {
	return Config{
		Port:           env("PORT", "4000"),
		AppURL:         env("APP_URL", "http://localhost:3000"),
		CORSOrigins:    strings.Split(env("CORS_ORIGINS", "http://localhost:3000"), ","),
		DSN:            env("DATABASE_DSN", "root:@tcp(127.0.0.1:3306)/voxform?parseTime=true&charset=utf8mb4&collation=utf8mb4_unicode_ci"),
		MigrationsPath: env("MIGRATIONS_PATH", "migrations"),
		JWTSecret:      env("JWT_SECRET", "change-me-in-production-use-openssl-rand-hex-64"),
		JWTAccessTTL:   envDuration("JWT_ACCESS_TTL", 15*time.Minute),
		JWTRefreshTTL:  envDuration("JWT_REFRESH_TTL", 7*24*time.Hour),
		StoragePath:    env("STORAGE_PATH", "storage"),
		StorageURL:     env("STORAGE_URL", "http://localhost:4000/storage"),
		GroqAPIKey:     env("GROQ_API_KEY", ""),
		AnthropicKey:   env("ANTHROPIC_API_KEY", ""),
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return fallback
	}
	return d
}

func envInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}
