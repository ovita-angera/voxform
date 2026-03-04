package models

import (
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

type Session struct {
	ID            string     `db:"id"             json:"id"`
	SurveyID      string     `db:"survey_id"       json:"surveyId"`
	SurveyorID    string     `db:"surveyor_id"     json:"surveyorId"`
	RespondentRef *string    `db:"respondent_ref"  json:"respondentRef"`
	Status        string     `db:"status"          json:"status"`
	SyncSource    string     `db:"sync_source"     json:"syncSource"`
	StartedAt     time.Time  `db:"started_at"      json:"startedAt"`
	CompletedAt   *time.Time `db:"completed_at"    json:"completedAt"`
	Location      JSON       `db:"location"        json:"location"`
	DeviceInfo    JSON       `db:"device_info"     json:"deviceInfo"`
	CreatedAt     time.Time  `db:"created_at"      json:"createdAt"`
}

type Response struct {
	ID              string     `db:"id"                json:"id"`
	SessionID       string     `db:"session_id"         json:"sessionId"`
	QuestionID      string     `db:"question_id"        json:"questionId"`
	Type            string     `db:"type"              json:"type"`
	TextValue       *string    `db:"text_value"         json:"textValue"`
	AudioURL        *string    `db:"audio_url"          json:"audioUrl"`
	AudioWavURL     *string    `db:"audio_wav_url"      json:"audioWavUrl"`
	AudioDurationSec *float64  `db:"audio_duration_sec" json:"audioDurationSec"`
	QCResult        JSON       `db:"qc_result"          json:"qcResult"`
	Transcript      JSON       `db:"transcript"         json:"transcript"`
	ExtractedValue  JSON       `db:"extracted_value"    json:"extractedValue"`
	ConfidenceScore *float64   `db:"confidence_score"   json:"confidenceScore"`
	Status          string     `db:"status"             json:"status"`
	ReviewedBy      *string    `db:"reviewed_by"        json:"reviewedBy"`
	ReviewedAt      *time.Time `db:"reviewed_at"        json:"reviewedAt"`
	CreatedAt       time.Time  `db:"created_at"         json:"createdAt"`
}

type AudioJob struct {
	ID              string    `db:"id"               json:"id"`
	ResponseID      string    `db:"response_id"       json:"responseId"`
	Status          string    `db:"status"           json:"status"`
	WavPath         *string   `db:"wav_path"          json:"wavPath"`
	Mp3Path         *string   `db:"mp3_path"          json:"mp3Path"`
	QCServerResult  JSON      `db:"qc_server_result"  json:"qcServerResult"`
	TranscriptRaw   JSON      `db:"transcript_raw"    json:"transcriptRaw"`
	ExtractedData   JSON      `db:"extracted_data"    json:"extractedData"`
	Provider        string    `db:"provider"         json:"provider"`
	Error           *string   `db:"error"            json:"error"`
	AttemptCount    int       `db:"attempt_count"    json:"attemptCount"`
	ProcessingMs    *int      `db:"processing_ms"    json:"processingMs"`
	CreatedAt       time.Time `db:"created_at"       json:"createdAt"`
	UpdatedAt       time.Time `db:"updated_at"       json:"updatedAt"`
}

// ── Session queries ───────────────────────────────────────────────────────────

func GetSession(db *sqlx.DB, id, orgID string) (*Session, error) {
	s := &Session{}
	err := db.Get(s, `
		SELECT s.* FROM sessions s
		JOIN surveys sv ON sv.id = s.survey_id
		WHERE s.id = ? AND sv.org_id = ? LIMIT 1
	`, id, orgID)
	return s, err
}

func ListSessions(db *sqlx.DB, orgID string, surveyID, status string, page, pageSize int) ([]Session, int, error) {
	if page < 1 { page = 1 }
	if pageSize < 1 { pageSize = 20 }

	base := `FROM sessions s JOIN surveys sv ON sv.id = s.survey_id WHERE sv.org_id = ?`
	args := []any{orgID}
	if surveyID != "" { base += ` AND s.survey_id = ?`; args = append(args, surveyID) }
	if status != ""   { base += ` AND s.status = ?`;    args = append(args, status) }

	var total int
	db.Get(&total, "SELECT COUNT(*) "+base, args...)

	offset := (page - 1) * pageSize
	query := fmt.Sprintf("SELECT s.* %s ORDER BY s.started_at DESC LIMIT %d OFFSET %d", base, pageSize, offset)
	var sessions []Session
	err := db.Select(&sessions, query, args...)
	return sessions, total, err
}

// ── Response queries ──────────────────────────────────────────────────────────

func GetResponse(db *sqlx.DB, id, orgID string) (*Response, error) {
	r := &Response{}
	err := db.Get(r, `
		SELECT r.* FROM responses r
		JOIN sessions s ON s.id = r.session_id
		JOIN surveys sv ON sv.id = s.survey_id
		WHERE r.id = ? AND sv.org_id = ? LIMIT 1
	`, id, orgID)
	return r, err
}

func GetAudioJob(db *sqlx.DB, responseID string) (*AudioJob, error) {
	j := &AudioJob{}
	err := db.Get(j, `SELECT * FROM audio_jobs WHERE response_id = ? LIMIT 1`, responseID)
	return j, err
}
