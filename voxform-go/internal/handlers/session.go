package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/voxform/api/internal/db"
	"github.com/voxform/api/internal/middleware"
	"github.com/voxform/api/internal/models"
)

type SessionHandler struct{ db *db.DB }

func NewSessionHandler(d *db.DB) *SessionHandler { return &SessionHandler{db: d} }

func (h *SessionHandler) List(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("pageSize"))
	sessions, total, err := models.ListSessions(h.db.DB, claims.OrgID, q.Get("surveyId"), q.Get("status"), page, pageSize)
	if err != nil { InternalError(w, err); return }
	OK(w, map[string]any{"data": sessions, "meta": map[string]any{"total": total}})
}

func (h *SessionHandler) Get(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	session, err := models.GetSession(h.db.DB, chi.URLParam(r, "id"), claims.OrgID)
	if err != nil { NotFound(w, "session not found"); return }
	OK(w, session)
}

func (h *SessionHandler) Start(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	var body struct {
		SurveyID      string      `json:"surveyId"`
		RespondentRef *string     `json:"respondentRef"`
		SyncSource    string      `json:"syncSource"`
		Location      models.JSON `json:"location"`
		DeviceInfo    models.JSON `json:"deviceInfo"`
	}
	if err := Decode(r, &body); err != nil || body.SurveyID == "" {
		BadRequest(w, "surveyId is required"); return
	}

	// Verify survey belongs to org
	var count int
	h.db.DB.Get(&count, `SELECT COUNT(*) FROM surveys WHERE id = ? AND org_id = ?`, body.SurveyID, claims.OrgID)
	if count == 0 { NotFound(w, "survey not found"); return }

	src := body.SyncSource
	if src == "" { src = "ONLINE" }
	loc := body.Location
	if loc == nil { loc = models.JSON("null") }
	dev := body.DeviceInfo
	if dev == nil { dev = models.JSON("{}") }

	id := newID()
	h.db.Exec(`
		INSERT INTO sessions (id, survey_id, surveyor_id, respondent_ref, status, sync_source, started_at, location, device_info, created_at, updated_at)
		VALUES (?, ?, ?, ?, 'IN_PROGRESS', ?, NOW(), ?, ?, NOW(), NOW())
	`, id, body.SurveyID, claims.UserID, body.RespondentRef, src, string(loc), string(dev))

	session, _ := models.GetSession(h.db.DB, id, claims.OrgID)
	Created(w, session)
}

func (h *SessionHandler) Complete(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	id := chi.URLParam(r, "id")
	if _, err := models.GetSession(h.db.DB, id, claims.OrgID); err != nil {
		NotFound(w, "session not found"); return
	}
	now := time.Now()
	h.db.Exec(`UPDATE sessions SET status = 'COMPLETED', completed_at = ?, updated_at = NOW() WHERE id = ?`, now, id)
	session, _ := models.GetSession(h.db.DB, id, claims.OrgID)
	OK(w, session)
}

func (h *SessionHandler) Abandon(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	id := chi.URLParam(r, "id")
	h.db.Exec(`UPDATE sessions SET status = 'ABANDONED', updated_at = NOW() WHERE id = ?`, id)
	session, _ := models.GetSession(h.db.DB, id, claims.OrgID)
	OK(w, session)
}

// BatchSync handles offline→online sync submissions
func (h *SessionHandler) BatchSync(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	var body struct {
		DeviceID string `json:"deviceId"`
		Items    []struct {
			ID   string         `json:"id"`
			Type string         `json:"type"`
			Data map[string]any `json:"data"`
		} `json:"items"`
	}
	if err := Decode(r, &body); err != nil { BadRequest(w, "invalid JSON"); return }

	synced, failed := 0, 0
	for _, item := range body.Items {
		switch item.Type {
		case "session":
			var count int
			h.db.DB.Get(&count, `SELECT COUNT(*) FROM sessions WHERE id = ?`, item.Data["id"])
			if count == 0 {
				sid, _ := item.Data["id"].(string)
				svid, _ := item.Data["surveyId"].(string)
				if sid != "" && svid != "" {
					h.db.Exec(`
						INSERT IGNORE INTO sessions (id, survey_id, surveyor_id, status, sync_source, started_at, created_at, updated_at)
						VALUES (?, ?, ?, 'COMPLETED', 'OFFLINE', NOW(), NOW(), NOW())
					`, sid, svid, claims.UserID)
					synced++
				}
			} else { synced++ }
		case "response":
			var count int
			id, _ := item.Data["id"].(string)
			h.db.DB.Get(&count, `SELECT COUNT(*) FROM responses WHERE id = ?`, id)
			if count == 0 {
				rid, _ := item.Data["id"].(string)
				sesID, _ := item.Data["sessionId"].(string)
				qid, _ := item.Data["questionId"].(string)
				typ, _ := item.Data["type"].(string)
				txt, _ := item.Data["textValue"].(string)
				if rid != "" && sesID != "" {
					h.db.Exec(`
						INSERT IGNORE INTO responses (id, session_id, question_id, type, text_value, status, created_at, updated_at)
						VALUES (?, ?, ?, ?, ?, 'SUBMITTED', NOW(), NOW())
					`, rid, sesID, qid, typ, txt)
					synced++
				}
			} else { synced++ }
		default:
			log.Warn().Str("type", item.Type).Msg("unknown sync item type")
			failed++
		}
	}
	OK(w, map[string]any{"synced": synced, "failed": failed})
}
