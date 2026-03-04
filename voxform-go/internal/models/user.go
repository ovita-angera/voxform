package models

import (
	"time"

	"github.com/jmoiron/sqlx"
)

type User struct {
	ID           string     `db:"id"            json:"id"`
	OrgID        string     `db:"org_id"         json:"orgId"`
	Role         string     `db:"role"           json:"role"`
	Name         string     `db:"name"           json:"name"`
	Email        string     `db:"email"          json:"email"`
	PasswordHash string     `db:"password_hash"  json:"-"`
	AvatarURL    *string    `db:"avatar_url"     json:"avatarUrl"`
	Preferences  JSON       `db:"preferences"    json:"preferences"`
	EmailVerified bool      `db:"email_verified" json:"emailVerified"`
	VerifyToken  *string    `db:"verify_token"   json:"-"`
	ResetToken   *string    `db:"reset_token"    json:"-"`
	ResetExpiry  *time.Time `db:"reset_expiry"   json:"-"`
	CreatedAt    time.Time  `db:"created_at"     json:"createdAt"`
	UpdatedAt    time.Time  `db:"updated_at"     json:"updatedAt"`

	// Joined fields
	Org *Org `db:"-" json:"org,omitempty"`
}

// Safe returns user without any sensitive fields, safe to send to client.
func (u *User) Safe() map[string]any {
	return map[string]any{
		"id":            u.ID,
		"orgId":         u.OrgID,
		"role":          u.Role,
		"name":          u.Name,
		"email":         u.Email,
		"avatarUrl":     u.AvatarURL,
		"emailVerified": u.EmailVerified,
		"preferences":   u.Preferences,
		"createdAt":     u.CreatedAt,
		"org":           u.Org,
	}
}

type Org struct {
	ID        string    `db:"id"         json:"id"`
	Name      string    `db:"name"       json:"name"`
	Slug      string    `db:"slug"       json:"slug"`
	Plan      string    `db:"plan"       json:"plan"`
	LogoURL   *string   `db:"logo_url"   json:"logoUrl"`
	Settings  JSON      `db:"settings"   json:"settings"`
	CreatedAt time.Time `db:"created_at" json:"createdAt"`
}

type RefreshToken struct {
	ID        string    `db:"id"`
	UserID    string    `db:"user_id"`
	TokenHash string    `db:"token_hash"`
	ExpiresAt time.Time `db:"expires_at"`
	CreatedAt time.Time `db:"created_at"`
}

// ── User queries ──────────────────────────────────────────────────────────────

func GetUserByEmail(db *sqlx.DB, email string) (*User, error) {
	u := &User{}
	err := db.Get(u, `SELECT * FROM users WHERE email = ? LIMIT 1`, email)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func GetUserByID(db *sqlx.DB, id string) (*User, error) {
	u := &User{}
	err := db.Get(u, `SELECT * FROM users WHERE id = ? LIMIT 1`, id)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func GetUserWithOrg(db *sqlx.DB, id string) (*User, error) {
	u := &User{}
	err := db.Get(u, `SELECT u.* FROM users u WHERE u.id = ? LIMIT 1`, id)
	if err != nil {
		return nil, err
	}
	org := &Org{}
	if err := db.Get(org, `SELECT * FROM organizations WHERE id = ? LIMIT 1`, u.OrgID); err == nil {
		u.Org = org
	}
	return u, nil
}

func GetUserByVerifyToken(db *sqlx.DB, token string) (*User, error) {
	u := &User{}
	err := db.Get(u, `SELECT * FROM users WHERE verify_token = ? LIMIT 1`, token)
	return u, err
}

func GetUserByResetToken(db *sqlx.DB, token string) (*User, error) {
	u := &User{}
	err := db.Get(u, `SELECT * FROM users WHERE reset_token = ? AND reset_expiry > NOW() LIMIT 1`, token)
	return u, err
}

func GetOrgMembers(db *sqlx.DB, orgID string) ([]map[string]any, error) {
	rows, err := db.Queryx(`
		SELECT u.id, u.name, u.email, u.avatar_url, u.role, m.role as member_role, m.joined_at
		FROM org_members m JOIN users u ON u.id = m.user_id
		WHERE m.org_id = ?
	`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []map[string]any
	for rows.Next() {
		row := map[string]any{}
		rows.MapScan(row)
		result = append(result, row)
	}
	return result, nil
}
