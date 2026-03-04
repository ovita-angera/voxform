package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"

	"github.com/voxform/api/internal/db"
	"github.com/voxform/api/internal/middleware"
	"github.com/voxform/api/internal/models"
	"github.com/voxform/api/internal/queue"
)

type AudioHandler struct {
	db          *db.DB
	queue       *queue.Queue
	storagePath string
	storageURL  string
}

func NewAudioHandler(database *db.DB, q *queue.Queue, storagePath, storageURL string) *AudioHandler {
	return &AudioHandler{db: database, queue: q, storagePath: storagePath, storageURL: storageURL}
}

// CreateSlot registers an upload intent and returns upload details.
func (h *AudioHandler) CreateSlot(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ResponseID string `json:"responseId"`
		Filename   string `json:"filename"`
		MimeType   string `json:"mimeType"`
	}
	if err := Decode(r, &body); err != nil || body.ResponseID == "" {
		BadRequest(w, "responseId is required"); return
	}

	ext := ".webm"
	if body.MimeType == "audio/wav" || body.MimeType == "audio/wave" {
		ext = ".wav"
	}

	uploadID := randHex(16)
	filename := uploadID + ext
	destPath := filepath.Join(h.storagePath, "audio", "raw", filename)
	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		InternalError(w, err); return
	}

	// Create or update AudioJob record
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
		"uploadId":   uploadID,
		"uploadPath": destPath,
		"uploadUrl":  fmt.Sprintf("%s/audio/raw/%s", h.storageURL, filename),
	})
}

// Upload receives the multipart audio file and enqueues processing.
func (h *AudioHandler) Upload(w http.ResponseWriter, r *http.Request) {
	uploadID := chi.URLParam(r, "uploadId")

	// 200MB max
	r.ParseMultipartForm(200 << 20)

	file, header, err := r.FormFile("file")
	if err != nil { BadRequest(w, "no file in request"); return }
	defer file.Close()

	responseID := r.FormValue("responseId")
	if responseID == "" { BadRequest(w, "responseId is required"); return }

	// Determine extension from mime type or filename
	ext := filepath.Ext(header.Filename)
	if ext == "" { ext = ".webm" }
	if header.Header.Get("Content-Type") == "audio/wav" { ext = ".wav" }

	destPath := filepath.Join(h.storagePath, "audio", "raw", uploadID+ext)
	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		InternalError(w, err); return
	}

	dst, err := os.Create(destPath)
	if err != nil { InternalError(w, err); return }
	defer dst.Close()

	written, err := io.Copy(dst, file)
	if err != nil { InternalError(w, err); return }

	// Update AudioJob with final path
	h.db.Exec(`UPDATE audio_jobs SET wav_path = ?, status = 'QC_PENDING', updated_at = NOW() WHERE response_id = ?`, destPath, responseID)

	// Parse optional client QC result
	if qcStr := r.FormValue("clientQcResult"); qcStr != "" {
		var qc map[string]any
		if json.Unmarshal([]byte(qcStr), &qc) == nil {
			qcJSON, _ := json.Marshal(qc)
			h.db.Exec(`UPDATE responses SET qc_result = ?, updated_at = NOW() WHERE id = ?`, string(qcJSON), responseID)
		}
	}

	// Enqueue processing
	h.queue.Enqueue("audio:process", map[string]any{"responseId": responseID})

	var job models.AudioJob
	h.db.DB.Get(&job, `SELECT * FROM audio_jobs WHERE response_id = ? LIMIT 1`, responseID)

	Created(w, map[string]any{
		"jobId":    job.ID,
		"bytes":    written,
		"filename": header.Filename,
	})
}

// JobStatus returns current processing status for polling.
func (h *AudioHandler) JobStatus(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	responseID := chi.URLParam(r, "responseId")

	// Verify ownership
	var count int
	h.db.DB.Get(&count, `
		SELECT COUNT(*) FROM responses r
		JOIN sessions s ON s.id = r.session_id
		JOIN surveys sv ON sv.id = s.survey_id
		WHERE r.id = ? AND sv.org_id = ?
	`, responseID, claims.OrgID)
	if count == 0 { NotFound(w, "response not found"); return }

	job, err := models.GetAudioJob(h.db.DB, responseID)
	if err != nil {
		OK(w, map[string]any{"status": "NOT_STARTED", "responseId": responseID}); return
	}
	OK(w, job)
}
