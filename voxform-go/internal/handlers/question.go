package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/voxform/api/internal/db"
	"github.com/voxform/api/internal/middleware"
	"github.com/voxform/api/internal/models"
)

type QuestionHandler struct{ db *db.DB }

func NewQuestionHandler(d *db.DB) *QuestionHandler { return &QuestionHandler{db: d} }

func (h *QuestionHandler) assertSurveyAccess(orgID, surveyID string) bool {
	var count int
	h.db.DB.Get(&count, `SELECT COUNT(*) FROM surveys WHERE id = ? AND org_id = ?`, surveyID, orgID)
	return count > 0
}

func (h *QuestionHandler) List(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	surveyID := chi.URLParam(r, "surveyId")
	if !h.assertSurveyAccess(claims.OrgID, surveyID) { NotFound(w, "survey not found"); return }
	qs, err := models.ListQuestions(h.db.DB, surveyID)
	if err != nil { InternalError(w, err); return }
	OK(w, qs)
}

func (h *QuestionHandler) Create(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	surveyID := chi.URLParam(r, "surveyId")
	if !h.assertSurveyAccess(claims.OrgID, surveyID) { NotFound(w, "survey not found"); return }

	var body struct {
		Type        string      `json:"type"`
		Title       string      `json:"title"`
		Description *string     `json:"description"`
		Required    bool        `json:"required"`
		Options     models.JSON `json:"options"`
		Logic       models.JSON `json:"logic"`
	}
	if err := Decode(r, &body); err != nil || body.Type == "" {
		BadRequest(w, "type is required"); return
	}

	var maxOrder int
	h.db.DB.Get(&maxOrder, `SELECT COALESCE(MAX(order_index),-1)+1 FROM questions WHERE survey_id = ?`, surveyID)

	opts := body.Options
	if opts == nil { opts = models.JSON("{}") }
	logic := body.Logic
	if logic == nil { logic = models.JSON("[]") }
	if body.Title == "" { body.Title = "Untitled question" }

	id := newID()
	_, err := h.db.Exec(`
		INSERT INTO questions (id, survey_id, type, title, description, required, order_index, options, logic, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
	`, id, surveyID, body.Type, body.Title, body.Description, body.Required, maxOrder, string(opts), string(logic))
	if err != nil { InternalError(w, err); return }

	q, _ := models.GetQuestion(h.db.DB, id, surveyID)
	Created(w, q)
}

func (h *QuestionHandler) Update(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	surveyID := chi.URLParam(r, "surveyId")
	id := chi.URLParam(r, "id")
	if !h.assertSurveyAccess(claims.OrgID, surveyID) { NotFound(w, "survey not found"); return }

	var body struct {
		Title       *string     `json:"title"`
		Description *string     `json:"description"`
		Required    *bool       `json:"required"`
		Options     models.JSON `json:"options"`
		Logic       models.JSON `json:"logic"`
		Order       *int        `json:"order"`
	}
	if err := Decode(r, &body); err != nil { BadRequest(w, "invalid JSON"); return }

	if body.Title       != nil { h.db.Exec(`UPDATE questions SET title = ?, updated_at = NOW() WHERE id = ?`, *body.Title, id) }
	if body.Description != nil { h.db.Exec(`UPDATE questions SET description = ?, updated_at = NOW() WHERE id = ?`, *body.Description, id) }
	if body.Required    != nil { h.db.Exec(`UPDATE questions SET required = ?, updated_at = NOW() WHERE id = ?`, *body.Required, id) }
	if body.Options     != nil { h.db.Exec(`UPDATE questions SET options = ?, updated_at = NOW() WHERE id = ?`, string(body.Options), id) }
	if body.Logic       != nil { h.db.Exec(`UPDATE questions SET logic = ?, updated_at = NOW() WHERE id = ?`, string(body.Logic), id) }
	if body.Order       != nil { h.db.Exec(`UPDATE questions SET order_index = ?, updated_at = NOW() WHERE id = ?`, *body.Order, id) }

	q, _ := models.GetQuestion(h.db.DB, id, surveyID)
	OK(w, q)
}

func (h *QuestionHandler) Reorder(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	surveyID := chi.URLParam(r, "surveyId")
	if !h.assertSurveyAccess(claims.OrgID, surveyID) { NotFound(w, "survey not found"); return }

	var body struct{ IDs []string `json:"ids"` }
	if err := Decode(r, &body); err != nil { BadRequest(w, "invalid JSON"); return }

	for i, id := range body.IDs {
		h.db.Exec(`UPDATE questions SET order_index = ?, updated_at = NOW() WHERE id = ? AND survey_id = ?`, i, id, surveyID)
	}
	OK(w, map[string]any{"reordered": len(body.IDs)})
}

func (h *QuestionHandler) Delete(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	surveyID := chi.URLParam(r, "surveyId")
	id := chi.URLParam(r, "id")
	if !h.assertSurveyAccess(claims.OrgID, surveyID) { NotFound(w, "survey not found"); return }
	h.db.Exec(`DELETE FROM questions WHERE id = ? AND survey_id = ?`, id, surveyID)
	w.WriteHeader(204)
}
