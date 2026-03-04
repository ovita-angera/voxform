package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/voxform/api/internal/db"
	"github.com/voxform/api/internal/middleware"
	"github.com/voxform/api/internal/models"
)

type ResponseHandler struct{ db *db.DB }

func NewResponseHandler(d *db.DB) *ResponseHandler { return &ResponseHandler{db: d} }

func (h *ResponseHandler) List(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("pageSize"))
	if page < 1 { page = 1 }
	if pageSize < 1 { pageSize = 20 }
	offset := (page - 1) * pageSize

	where := `FROM responses r JOIN sessions s ON s.id = r.session_id JOIN surveys sv ON sv.id = s.survey_id WHERE sv.org_id = ?`
	args := []any{claims.OrgID}
	if sid := q.Get("surveyId"); sid != "" { where += ` AND s.survey_id = ?`; args = append(args, sid) }
	if sesid := q.Get("sessionId"); sesid != "" { where += ` AND r.session_id = ?`; args = append(args, sesid) }
	if st := q.Get("status"); st != "" { where += ` AND r.status = ?`; args = append(args, st) }

	var total int
	h.db.DB.Get(&total, "SELECT COUNT(*) "+where, args...)

	var responses []models.Response
	h.db.DB.Select(&responses, fmt.Sprintf("SELECT r.* %s ORDER BY r.created_at DESC LIMIT %d OFFSET %d", where, pageSize, offset), args...)

	OK(w, map[string]any{"data": responses, "meta": map[string]any{"total": total, "page": page}})
}

func (h *ResponseHandler) Get(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	resp, err := models.GetResponse(h.db.DB, chi.URLParam(r, "id"), claims.OrgID)
	if err != nil { NotFound(w, "response not found"); return }
	OK(w, resp)
}

func (h *ResponseHandler) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SessionID        string      `json:"sessionId"`
		QuestionID       string      `json:"questionId"`
		Type             string      `json:"type"`
		TextValue        *string     `json:"textValue"`
		AudioURL         *string     `json:"audioUrl"`
		AudioWavURL      *string     `json:"audioWavUrl"`
		AudioDurationSec *float64    `json:"audioDurationSec"`
		QCResult         models.JSON `json:"qcResult"`
	}
	if err := Decode(r, &body); err != nil { BadRequest(w, "invalid JSON"); return }
	if body.SessionID == "" || body.QuestionID == "" || body.Type == "" {
		BadRequest(w, "sessionId, questionId, and type are required"); return
	}

	id := newID()
	qc := body.QCResult
	if qc == nil { qc = models.JSON("null") }

	h.db.Exec(`
		INSERT INTO responses (id, session_id, question_id, type, text_value, audio_url, audio_wav_url, audio_duration_sec, qc_result, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', NOW(), NOW())
	`, id, body.SessionID, body.QuestionID, body.Type, body.TextValue, body.AudioURL, body.AudioWavURL, body.AudioDurationSec, string(qc))

	resp, _ := models.GetResponse(h.db.DB, id, "")
	Created(w, resp)
}

func (h *ResponseHandler) review(w http.ResponseWriter, r *http.Request, status string) {
	claims := middleware.GetClaims(r)
	id := chi.URLParam(r, "id")
	if _, err := models.GetResponse(h.db.DB, id, claims.OrgID); err != nil {
		NotFound(w, "response not found"); return
	}
	now := time.Now()
	h.db.Exec(`UPDATE responses SET status = ?, reviewed_by = ?, reviewed_at = ?, updated_at = NOW() WHERE id = ?`,
		status, claims.UserID, now, id)
	resp, _ := models.GetResponse(h.db.DB, id, claims.OrgID)
	OK(w, resp)
}

func (h *ResponseHandler) Approve(w http.ResponseWriter, r *http.Request) { h.review(w, r, "APPROVED") }
func (h *ResponseHandler) Reject(w http.ResponseWriter, r *http.Request)  { h.review(w, r, "REJECTED") }

func (h *ResponseHandler) AudioJob(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	responseID := chi.URLParam(r, "id")
	if _, err := models.GetResponse(h.db.DB, responseID, claims.OrgID); err != nil {
		NotFound(w, "response not found"); return
	}
	job, err := models.GetAudioJob(h.db.DB, responseID)
	if err != nil { OK(w, map[string]any{"status": "NOT_STARTED", "responseId": responseID}); return }
	OK(w, job)
}
