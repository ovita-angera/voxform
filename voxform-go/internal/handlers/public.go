package handlers

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"

	"github.com/voxform/api/internal/db"
	"github.com/voxform/api/internal/models"
	"github.com/voxform/api/internal/queue"
)

type PublicHandler struct {
	db          *db.DB
	queue       *queue.Queue
	storagePath string
	storageURL  string
}

func NewPublicHandler(d *db.DB, q *queue.Queue, storagePath, storageURL string) *PublicHandler {
	return &PublicHandler{db: d, queue: q, storagePath: storagePath, storageURL: storageURL}
}

// GetBySlug returns a public survey with its questions.
func (h *PublicHandler) GetBySlug(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	survey, err := models.GetSurveyBySlug(h.db.DB, slug)
	if err != nil {
		NotFound(w, "survey not found or not active")
		return
	}

	questions, _ := models.ListQuestions(h.db.DB, survey.ID)

	OK(w, map[string]any{
		"id":          survey.ID,
		"title":       survey.Title,
		"description": survey.Description,
		"slug":        survey.Slug,
		"config":      survey.Config,
		"questions":   questions,
	})
}

// StartSession creates an anonymous respondent session for a public survey.
func (h *PublicHandler) StartSession(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	survey, err := models.GetSurveyBySlug(h.db.DB, slug)
	if err != nil {
		NotFound(w, "survey not found or not active")
		return
	}

	id := newID()
	h.db.Exec(`
		INSERT INTO sessions (id, survey_id, status, sync_source, started_at, device_info, created_at, updated_at)
		VALUES (?, ?, 'IN_PROGRESS', 'ONLINE', NOW(), '{}', NOW(), NOW())
	`, id, survey.ID)

	OK(w, map[string]any{"sessionId": id, "surveyId": survey.ID})
}

// SubmitResponse records a single question answer for an anonymous session.
func (h *PublicHandler) SubmitResponse(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "id")

	var count int
	h.db.DB.Get(&count, `SELECT COUNT(*) FROM sessions WHERE id = ? AND status = 'IN_PROGRESS'`, sessionID)
	if count == 0 {
		NotFound(w, "session not found or already completed")
		return
	}

	var body struct {
		QuestionID       string   `json:"questionId"`
		Type             string   `json:"type"`
		TextValue        *string  `json:"textValue"`
		AudioDurationSec *float64 `json:"audioDurationSec"`
	}
	if err := Decode(r, &body); err != nil || body.QuestionID == "" || body.Type == "" {
		BadRequest(w, "questionId and type are required")
		return
	}

	id := newID()
	h.db.Exec(`
		INSERT INTO responses (id, session_id, question_id, type, text_value, audio_duration_sec, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, 'SUBMITTED', NOW(), NOW())
	`, id, sessionID, body.QuestionID, body.Type, body.TextValue, body.AudioDurationSec)

	Created(w, map[string]any{"responseId": id})
}

// CompleteSession marks an anonymous session as completed.
func (h *PublicHandler) CompleteSession(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "id")
	h.db.Exec(`
		UPDATE sessions SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
		WHERE id = ? AND status = 'IN_PROGRESS'
	`, sessionID)
	OK(w, map[string]any{"sessionId": sessionID, "status": "COMPLETED"})
}

// CreateAudioSlot registers an upload intent for a public response.
func (h *PublicHandler) CreateAudioSlot(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ResponseID string `json:"responseId"`
		MimeType   string `json:"mimeType"`
	}
	if err := Decode(r, &body); err != nil || body.ResponseID == "" {
		BadRequest(w, "responseId is required")
		return
	}

	ext := ".webm"
	if body.MimeType == "audio/wav" || body.MimeType == "audio/wave" {
		ext = ".wav"
	}

	uploadID := randHex(16)
	filename := uploadID + ext
	destPath := filepath.Join(h.storagePath, "audio", "raw", filename)
	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		InternalError(w, err)
		return
	}

	var count int
	h.db.DB.Get(&count, `SELECT COUNT(*) FROM audio_jobs WHERE response_id = ?`, body.ResponseID)
	if count == 0 {
		h.db.Exec(`
			INSERT INTO audio_jobs (id, response_id, status, wav_path, provider, attempt_count, created_at, updated_at)
			VALUES (?, ?, 'UPLOADING', ?, 'GROQ', 0, NOW(), NOW())
		`, newID(), body.ResponseID, destPath)
	} else {
		h.db.Exec(`UPDATE audio_jobs SET status = 'UPLOADING', wav_path = ?, updated_at = NOW() WHERE response_id = ?`, destPath, body.ResponseID)
	}

	OK(w, map[string]any{
		"uploadId":  uploadID,
		"uploadUrl": fmt.Sprintf("%s/audio/raw/%s", h.storageURL, filename),
	})
}

// UploadAudio receives a multipart audio file for a public response and enqueues processing.
func (h *PublicHandler) UploadAudio(w http.ResponseWriter, r *http.Request) {
	uploadID := chi.URLParam(r, "uploadId")

	r.ParseMultipartForm(200 << 20)

	file, header, err := r.FormFile("file")
	if err != nil {
		BadRequest(w, "no file in request")
		return
	}
	defer file.Close()

	responseID := r.FormValue("responseId")
	if responseID == "" {
		BadRequest(w, "responseId is required")
		return
	}

	ext := filepath.Ext(header.Filename)
	if ext == "" {
		ext = ".webm"
	}
	if header.Header.Get("Content-Type") == "audio/wav" {
		ext = ".wav"
	}

	destPath := filepath.Join(h.storagePath, "audio", "raw", uploadID+ext)
	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		InternalError(w, err)
		return
	}

	dst, err := os.Create(destPath)
	if err != nil {
		InternalError(w, err)
		return
	}
	defer dst.Close()

	written, err := io.Copy(dst, file)
	if err != nil {
		InternalError(w, err)
		return
	}

	h.db.Exec(`UPDATE audio_jobs SET wav_path = ?, status = 'QC_PENDING', updated_at = NOW() WHERE response_id = ?`, destPath, responseID)

	h.queue.Enqueue("audio:process", map[string]any{"responseId": responseID})

	Created(w, map[string]any{"bytes": written})
}
