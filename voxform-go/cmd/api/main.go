package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/voxform/api/internal/auth"
	"github.com/voxform/api/internal/db"
	"github.com/voxform/api/internal/handlers"
	"github.com/voxform/api/internal/middleware"
	"github.com/voxform/api/internal/queue"
)

func main() {
	// ── Logger ────────────────────────────────────────────────────────────────
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: "15:04:05"})

	// ── Config ────────────────────────────────────────────────────────────────
	cfg := loadConfig()

	// ── Database ──────────────────────────────────────────────────────────────
	database, err := db.Connect(cfg.DSN)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to database")
	}
	defer database.Close()

	if err := db.Migrate(cfg.DSN, cfg.MigrationsPath); err != nil {
		log.Fatal().Err(err).Msg("migration failed")
	}
	log.Info().Msg("database ready")

	// ── Queue ─────────────────────────────────────────────────────────────────
	q := queue.New(database, cfg.StoragePath, cfg.GroqAPIKey, cfg.AnthropicKey, 3)
	q.Start()
	defer q.Stop()

	// ── Auth ──────────────────────────────────────────────────────────────────
	jwtSvc := auth.NewJWTService(cfg.JWTSecret, cfg.JWTAccessTTL, cfg.JWTRefreshTTL)

	// ── Handlers ──────────────────────────────────────────────────────────────
	authH := handlers.NewAuthHandler(database, jwtSvc, cfg.AppURL)
	surveyH := handlers.NewSurveyHandler(database)
	questionH := handlers.NewQuestionHandler(database)
	sessionH := handlers.NewSessionHandler(database)
	responseH := handlers.NewResponseHandler(database)
	audioH := handlers.NewAudioHandler(database, q, cfg.StoragePath, cfg.StorageURL)
	publicH := handlers.NewPublicHandler(database, q, cfg.StoragePath, cfg.StorageURL)
	userH := handlers.NewUserHandler(database)

	// ── Router ────────────────────────────────────────────────────────────────
	r := chi.NewRouter()

	// Global middleware
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(middleware.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Compress(5))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Serve local storage files (audio, uploads)
	r.Handle("/storage/*", http.StripPrefix("/storage/", http.FileServer(http.Dir(cfg.StoragePath))))

	// API routes
	r.Route("/api/v1", func(r chi.Router) {
		// Public — no auth
		r.Post("/auth/register", authH.Register)
		r.Post("/auth/login", authH.Login)
		r.Post("/auth/refresh", authH.Refresh)
		r.Post("/auth/logout", authH.Logout)
		r.Get("/auth/verify-email", authH.VerifyEmail)
		r.Post("/auth/forgot-password", authH.ForgotPassword)
		r.Post("/auth/reset-password", authH.ResetPassword)

		r.Get("/public/surveys/{slug}", publicH.GetBySlug)
		r.Post("/public/surveys/{slug}/session", publicH.StartSession)
		r.Post("/public/sessions/{id}/response", publicH.SubmitResponse)
		r.Patch("/public/sessions/{id}/complete", publicH.CompleteSession)
		r.Post("/public/audio/slot", publicH.CreateAudioSlot)
		r.Post("/public/audio/upload/{uploadId}", publicH.UploadAudio)

		// Protected — requires JWT
		r.Group(func(r chi.Router) {
			r.Use(middleware.Authenticate(jwtSvc))

			r.Get("/auth/me", authH.Me)

			// Users
			r.Get("/users/me", userH.Me)
			r.Put("/users/me", userH.Update)
			r.Get("/users/org/members", userH.OrgMembers)

			// Surveys
			r.Get("/surveys", surveyH.List)
			r.Post("/surveys", surveyH.Create)
			r.Get("/surveys/{id}", surveyH.Get)
			r.Put("/surveys/{id}", surveyH.Update)
			r.Delete("/surveys/{id}", surveyH.Delete)
			r.Post("/surveys/{id}/duplicate", surveyH.Duplicate)
			r.Patch("/surveys/{id}/status", surveyH.UpdateStatus)
			r.Get("/surveys/{id}/stats", surveyH.Stats)
			r.Get("/surveys/{id}/versions", surveyH.Versions)

			// Questions (nested under survey)
			r.Get("/surveys/{surveyId}/questions", questionH.List)
			r.Post("/surveys/{surveyId}/questions", questionH.Create)
			r.Put("/surveys/{surveyId}/questions/{id}", questionH.Update)
			r.Delete("/surveys/{surveyId}/questions/{id}", questionH.Delete)
			r.Post("/surveys/{surveyId}/questions/reorder", questionH.Reorder)

			// Sessions
			r.Get("/sessions", sessionH.List)
			r.Post("/sessions", sessionH.Start)
			r.Get("/sessions/{id}", sessionH.Get)
			r.Patch("/sessions/{id}/complete", sessionH.Complete)
			r.Patch("/sessions/{id}/abandon", sessionH.Abandon)

			// Responses
			r.Get("/responses", responseH.List)
			r.Post("/responses", responseH.Create)
			r.Get("/responses/{id}", responseH.Get)
			r.Patch("/responses/{id}/approve", responseH.Approve)
			r.Patch("/responses/{id}/reject", responseH.Reject)
			r.Get("/responses/{id}/audio-job", responseH.AudioJob)

			// Audio
			r.Post("/audio/upload-slot", audioH.CreateSlot)
			r.Post("/audio/upload/{uploadId}", audioH.Upload)
			r.Get("/audio/job/{responseId}", audioH.JobStatus)

			// Sync (offline)
			r.Post("/sync/batch", sessionH.BatchSync)
		})
	})

	// ── Server ────────────────────────────────────────────────────────────────
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", cfg.Port),
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 120 * time.Second, // long for audio uploads
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Info().
			Str("addr", "http://localhost:"+cfg.Port).
			Str("api", "http://localhost:"+cfg.Port+"/api/v1").
			Str("storage", "http://localhost:"+cfg.Port+"/storage").
			Msg("🚀 Voxform API started")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("server error")
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info().Msg("shutting down…")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}
