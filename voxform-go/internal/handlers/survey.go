package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/voxform/api/internal/db"
	"github.com/voxform/api/internal/middleware"
	"github.com/voxform/api/internal/models"
)

// Plan limits
var planMaxSurveys = map[string]int{
	"FREE": 3, "STARTER": 10, "PRO": 9999, "BUSINESS": 9999, "ENTERPRISE": 9999,
}

type SurveyHandler struct{ db *db.DB }

func NewSurveyHandler(d *db.DB) *SurveyHandler { return &SurveyHandler{db: d} }

func (h *SurveyHandler) List(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("pageSize"))
	surveys, total, err := models.ListSurveys(h.db.DB, claims.OrgID, models.SurveyFilter{
		Page: page, PageSize: pageSize,
		Status: q.Get("status"), Search: q.Get("search"),
	})
	if err != nil { InternalError(w, err); return }
	OK(w, map[string]any{
		"data": surveys,
		"meta": map[string]any{"total": total, "page": page, "pageSize": pageSize},
	})
}

func (h *SurveyHandler) Get(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	id := chi.URLParam(r, "id")
	survey, err := models.GetSurvey(h.db.DB, id, claims.OrgID)
	if err != nil { NotFound(w, "survey not found"); return }
	OK(w, survey)
}

func (h *SurveyHandler) Create(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	var body struct {
		Title       string      `json:"title"`
		Description *string     `json:"description"`
		Config      models.JSON `json:"config"`
		QCStandards models.JSON `json:"qcStandards"`
		Quota       *int        `json:"quota"`
	}
	if err := Decode(r, &body); err != nil || body.Title == "" {
		BadRequest(w, "title is required"); return
	}

	// Enforce plan limit
	var plan string
	h.db.DB.Get(&plan, `SELECT plan FROM organizations WHERE id = ? LIMIT 1`, claims.OrgID)
	count, _ := models.CountSurveysByOrg(h.db.DB, claims.OrgID)
	limit := planMaxSurveys[plan]
	if limit == 0 { limit = 3 }
	if count >= limit {
		Err(w, 403, "survey limit reached for your plan"); return
	}

	id := newID()
	slug := slugify(body.Title) + "-" + randHex(4)
	cfg := body.Config
	if cfg == nil { cfg = models.JSON(`{"allowBack":true,"showProgress":true}`) }
	qc := body.QCStandards
	if qc == nil { qc = models.JSON(`{"minDurationSec":15,"maxSilenceRatio":0.7}`) }

	if _, err := h.db.Exec(`
		INSERT INTO surveys (id, org_id, owner_id, title, description, slug, status, config, qc_standards, quota, response_count, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 0, NOW(), NOW())
	`, id, claims.OrgID, claims.UserID, body.Title, body.Description, slug, string(cfg), string(qc), body.Quota); err != nil {
		InternalError(w, err); return
	}

	survey, _ := models.GetSurvey(h.db.DB, id, claims.OrgID)
	Created(w, survey)
}

func (h *SurveyHandler) Update(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	id := chi.URLParam(r, "id")
	if _, err := models.GetSurvey(h.db.DB, id, claims.OrgID); err != nil {
		NotFound(w, "survey not found"); return
	}
	var body struct {
		Title       *string     `json:"title"`
		Description *string     `json:"description"`
		Config      models.JSON `json:"config"`
		QCStandards models.JSON `json:"qcStandards"`
		Quota       *int        `json:"quota"`
	}
	if err := Decode(r, &body); err != nil { BadRequest(w, "invalid JSON"); return }

	if body.Title != nil {
		h.db.Exec(`UPDATE surveys SET title = ?, updated_at = NOW() WHERE id = ?`, *body.Title, id)
	}
	if body.Description != nil {
		h.db.Exec(`UPDATE surveys SET description = ?, updated_at = NOW() WHERE id = ?`, *body.Description, id)
	}
	if body.Config != nil {
		h.db.Exec(`UPDATE surveys SET config = ?, updated_at = NOW() WHERE id = ?`, string(body.Config), id)
	}
	if body.QCStandards != nil {
		h.db.Exec(`UPDATE surveys SET qc_standards = ?, updated_at = NOW() WHERE id = ?`, string(body.QCStandards), id)
	}
	if body.Quota != nil {
		h.db.Exec(`UPDATE surveys SET quota = ?, updated_at = NOW() WHERE id = ?`, *body.Quota, id)
	}

	// Snapshot version
	survey, _ := models.GetSurvey(h.db.DB, id, claims.OrgID)
	var maxVer int
	h.db.DB.Get(&maxVer, `SELECT COALESCE(MAX(version),0) FROM survey_versions WHERE survey_id = ?`, id)
	snap, _ := models.Encode(survey)
	h.db.Exec(`INSERT INTO survey_versions (id, survey_id, version, snapshot, created_by, created_at) VALUES (?, ?, ?, ?, ?, NOW())`,
		newID(), id, maxVer+1, string(snap), claims.UserID)

	OK(w, survey)
}

func (h *SurveyHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	id := chi.URLParam(r, "id")
	if _, err := models.GetSurvey(h.db.DB, id, claims.OrgID); err != nil {
		NotFound(w, "survey not found"); return
	}
	var body struct{ Status string `json:"status"` }
	if err := Decode(r, &body); err != nil { BadRequest(w, "invalid JSON"); return }

	valid := map[string]bool{"ACTIVE": true, "PAUSED": true, "DRAFT": true, "CLOSED": true, "ARCHIVED": true}
	if !valid[body.Status] { BadRequest(w, "invalid status"); return }

	h.db.Exec(`UPDATE surveys SET status = ?, updated_at = NOW() WHERE id = ?`, body.Status, id)
	survey, _ := models.GetSurvey(h.db.DB, id, claims.OrgID)
	OK(w, survey)
}

func (h *SurveyHandler) Delete(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	id := chi.URLParam(r, "id")
	if _, err := models.GetSurvey(h.db.DB, id, claims.OrgID); err != nil {
		NotFound(w, "survey not found"); return
	}
	h.db.Exec(`DELETE FROM surveys WHERE id = ?`, id)
	w.WriteHeader(204)
}

func (h *SurveyHandler) Duplicate(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	id := chi.URLParam(r, "id")
	src, err := models.GetSurvey(h.db.DB, id, claims.OrgID)
	if err != nil { NotFound(w, "survey not found"); return }

	newSurveyID := newID()
	newSlug := src.Slug + "-copy-" + randHex(3)
	h.db.Exec(`
		INSERT INTO surveys (id, org_id, owner_id, title, description, slug, status, config, qc_standards, quota, response_count, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 0, NOW(), NOW())
	`, newSurveyID, claims.OrgID, claims.UserID, src.Title+" (copy)", src.Description, newSlug, string(src.Config), string(src.QCStandards), src.Quota)

	// Copy questions
	qs, _ := models.ListQuestions(h.db.DB, id)
	for _, q := range qs {
		h.db.Exec(`
			INSERT INTO questions (id, survey_id, type, title, description, required, order_index, options, logic, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
		`, newID(), newSurveyID, q.Type, q.Title, q.Description, q.Required, q.Order, string(q.Options), string(q.Logic))
	}

	survey, _ := models.GetSurvey(h.db.DB, newSurveyID, claims.OrgID)
	Created(w, survey)
}

func (h *SurveyHandler) Stats(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	id := chi.URLParam(r, "id")
	if _, err := models.GetSurvey(h.db.DB, id, claims.OrgID); err != nil {
		NotFound(w, "survey not found"); return
	}

	var stats struct {
		ResponseCount  int     `db:"response_count"   json:"responseCount"`
		CompletedCount int     `db:"completed_count"  json:"completedCount"`
		AvgDurationSec float64 `db:"avg_duration_sec" json:"avgDurationSec"`
	}
	h.db.DB.Get(&stats, `
		SELECT
			COUNT(DISTINCT se.id) as response_count,
			COUNT(DISTINCT CASE WHEN se.status = 'COMPLETED' THEN se.id END) as completed_count,
			COALESCE(AVG(r.audio_duration_sec),0) as avg_duration_sec
		FROM sessions se
		LEFT JOIN responses r ON r.session_id = se.id AND r.audio_duration_sec IS NOT NULL
		WHERE se.survey_id = ?
	`, id)
	OK(w, stats)
}

func (h *SurveyHandler) Versions(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	id := chi.URLParam(r, "id")
	if _, err := models.GetSurvey(h.db.DB, id, claims.OrgID); err != nil {
		NotFound(w, "survey not found"); return
	}
	var versions []struct {
		ID        string    `db:"id"         json:"id"`
		Version   int       `db:"version"    json:"version"`
		CreatedBy string    `db:"created_by" json:"createdBy"`
		CreatedAt time.Time `db:"created_at" json:"createdAt"`
	}
	h.db.DB.Select(&versions, `SELECT id, version, created_by, created_at FROM survey_versions WHERE survey_id = ? ORDER BY version DESC`, id)
	OK(w, versions)
}
