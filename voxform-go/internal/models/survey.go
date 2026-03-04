package models

import (
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

type Survey struct {
	ID            string     `db:"id"             json:"id"`
	OrgID         string     `db:"org_id"          json:"orgId"`
	OwnerID       string     `db:"owner_id"        json:"ownerId"`
	Title         string     `db:"title"           json:"title"`
	Description   *string    `db:"description"     json:"description"`
	Slug          string     `db:"slug"            json:"slug"`
	Status        string     `db:"status"          json:"status"`
	Config        JSON       `db:"config"          json:"config"`
	QCStandards   JSON       `db:"qc_standards"    json:"qcStandards"`
	Quota         *int       `db:"quota"           json:"quota"`
	ResponseCount int        `db:"response_count"  json:"responseCount"`
	ExpiresAt     *time.Time `db:"expires_at"      json:"expiresAt"`
	CreatedAt     time.Time  `db:"created_at"      json:"createdAt"`
	UpdatedAt     time.Time  `db:"updated_at"      json:"updatedAt"`
}

type Question struct {
	ID            string    `db:"id"              json:"id"`
	SurveyID      string    `db:"survey_id"        json:"surveyId"`
	Type          string    `db:"type"            json:"type"`
	Title         string    `db:"title"           json:"title"`
	Description   *string   `db:"description"     json:"description"`
	Required      bool      `db:"required"        json:"required"`
	Order         int       `db:"order_index"     json:"order"`
	Options       JSON      `db:"options"         json:"options"`
	Logic         JSON      `db:"logic"           json:"logic"`
	AudioPromptURL *string  `db:"audio_prompt_url" json:"audioPromptUrl"`
	CreatedAt     time.Time `db:"created_at"      json:"createdAt"`
	UpdatedAt     time.Time `db:"updated_at"      json:"updatedAt"`
}

// ── Survey queries ─────────────────────────────────────────────────────────

type SurveyFilter struct {
	Page     int
	PageSize int
	Status   string
	Search   string
}

func ListSurveys(db *sqlx.DB, orgID string, f SurveyFilter) ([]Survey, int, error) {
	if f.Page < 1 { f.Page = 1 }
	if f.PageSize < 1 { f.PageSize = 20 }

	where := []string{"org_id = ?"}
	args := []any{orgID}

	if f.Status != "" {
		where = append(where, "status = ?")
		args = append(args, f.Status)
	}
	if f.Search != "" {
		where = append(where, "title LIKE ?")
		args = append(args, "%"+f.Search+"%")
	}

	clause := "WHERE " + strings.Join(where, " AND ")
	var total int
	if err := db.Get(&total, "SELECT COUNT(*) FROM surveys "+clause, args...); err != nil {
		return nil, 0, err
	}

	offset := (f.Page - 1) * f.PageSize
	query := fmt.Sprintf("SELECT * FROM surveys %s ORDER BY created_at DESC LIMIT %d OFFSET %d", clause, f.PageSize, offset)
	var surveys []Survey
	if err := db.Select(&surveys, query, args...); err != nil {
		return nil, 0, err
	}
	return surveys, total, nil
}

func GetSurvey(db *sqlx.DB, id, orgID string) (*Survey, error) {
	s := &Survey{}
	err := db.Get(s, `SELECT * FROM surveys WHERE id = ? AND org_id = ? LIMIT 1`, id, orgID)
	return s, err
}

func GetSurveyBySlug(db *sqlx.DB, slug string) (*Survey, error) {
	s := &Survey{}
	err := db.Get(s, `SELECT * FROM surveys WHERE slug = ? AND status = 'ACTIVE' LIMIT 1`, slug)
	return s, err
}

func CountSurveysByOrg(db *sqlx.DB, orgID string) (int, error) {
	var n int
	err := db.Get(&n, `SELECT COUNT(*) FROM surveys WHERE org_id = ?`, orgID)
	return n, err
}

// ── Question queries ──────────────────────────────────────────────────────────

func ListQuestions(db *sqlx.DB, surveyID string) ([]Question, error) {
	var qs []Question
	err := db.Select(&qs, `SELECT * FROM questions WHERE survey_id = ? ORDER BY order_index ASC`, surveyID)
	return qs, err
}

func GetQuestion(db *sqlx.DB, id, surveyID string) (*Question, error) {
	q := &Question{}
	err := db.Get(q, `SELECT * FROM questions WHERE id = ? AND survey_id = ? LIMIT 1`, id, surveyID)
	return q, err
}
