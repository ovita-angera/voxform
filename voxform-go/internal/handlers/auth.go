package handlers

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/bcrypt"

	"github.com/voxform/api/internal/auth"
	"github.com/voxform/api/internal/db"
	"github.com/voxform/api/internal/middleware"
	"github.com/voxform/api/internal/models"
)

type AuthHandler struct {
	db     *db.DB
	jwt    *auth.JWTService
	appURL string
}

func NewAuthHandler(database *db.DB, jwt *auth.JWTService, appURL string) *AuthHandler {
	return &AuthHandler{db: database, jwt: jwt, appURL: appURL}
}

// ── Register ──────────────────────────────────────────────────────────────────

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name    string `json:"name"`
		Email   string `json:"email"`
		Password string `json:"password"`
		OrgName  string `json:"orgName"`
	}
	if err := Decode(r, &body); err != nil { BadRequest(w, "invalid JSON"); return }
	if body.Name == "" || body.Email == "" || body.Password == "" || body.OrgName == "" {
		BadRequest(w, "name, email, password and orgName are required"); return
	}
	if len(body.Password) < 8 { BadRequest(w, "password must be at least 8 characters"); return }

	email := strings.ToLower(strings.TrimSpace(body.Email))

	// Check duplicate
	existing, _ := models.GetUserByEmail(h.db.DB, email)
	if existing != nil { Conflict(w, "an account with this email already exists"); return }

	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), 12)
	if err != nil { InternalError(w, err); return }

	verifyToken := randHex(32)
	orgSlug := slugify(body.OrgName) + "-" + randHex(3)
	orgID := newID()
	userID := newID()

	// Create org
	if _, err := h.db.Exec(`
		INSERT INTO organizations (id, name, slug, plan, settings, created_at, updated_at)
		VALUES (?, ?, ?, 'FREE', '{"defaultAudioFormat":"WAV_16K","timezone":"UTC"}', NOW(), NOW())
	`, orgID, body.OrgName, orgSlug); err != nil {
		InternalError(w, err); return
	}

	// Create user
	if _, err := h.db.Exec(`
		INSERT INTO users (id, org_id, role, name, email, password_hash, verify_token, preferences, email_verified, created_at, updated_at)
		VALUES (?, ?, 'OWNER', ?, ?, ?, ?, '{"language":"en","timezone":"UTC"}', FALSE, NOW(), NOW())
	`, userID, orgID, body.Name, email, string(hash), verifyToken); err != nil {
		InternalError(w, err); return
	}

	// Create org_member
	h.db.Exec(`INSERT INTO org_members (id, org_id, user_id, role, invited_at, joined_at) VALUES (?, ?, ?, 'OWNER', NOW(), NOW())`, newID(), orgID, userID)

	// Log verify URL (console email)
	log.Info().Msgf("VERIFY EMAIL for %s: %s/verify-email?token=%s", email, h.appURL, verifyToken)

	user, _ := models.GetUserWithOrg(h.db.DB, userID)
	tokens, err := h.issueTokens(w, user)
	if err != nil { InternalError(w, err); return }

	Created(w, map[string]any{"user": user.Safe(), "accessToken": tokens[0], "expiresIn": 900})
}

// ── Login ─────────────────────────────────────────────────────────────────────

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := Decode(r, &body); err != nil { BadRequest(w, "invalid JSON"); return }

	user, err := models.GetUserByEmail(h.db.DB, strings.ToLower(body.Email))
	if err != nil { Err(w, 401, "invalid email or password"); return }

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(body.Password)); err != nil {
		Err(w, 401, "invalid email or password"); return
	}

	// Load org
	user2, _ := models.GetUserWithOrg(h.db.DB, user.ID)

	tokens, err := h.issueTokens(w, user2)
	if err != nil { InternalError(w, err); return }

	OK(w, map[string]any{"user": user2.Safe(), "accessToken": tokens[0], "expiresIn": 900})
}

// ── Refresh ───────────────────────────────────────────────────────────────────

func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("vf_refresh")
	if err != nil { Unauthorized(w); return }

	hash := auth.HashToken(cookie.Value)
	var stored struct {
		UserID    string    `db:"user_id"`
		ExpiresAt time.Time `db:"expires_at"`
		ID        string    `db:"id"`
	}
	if err := h.db.Get(&stored, `SELECT id, user_id, expires_at FROM refresh_tokens WHERE token_hash = ? LIMIT 1`, hash); err != nil {
		Unauthorized(w); return
	}
	if stored.ExpiresAt.Before(time.Now()) {
		h.db.Exec(`DELETE FROM refresh_tokens WHERE id = ?`, stored.ID)
		Unauthorized(w); return
	}

	// Rotate
	h.db.Exec(`DELETE FROM refresh_tokens WHERE id = ?`, stored.ID)
	user, _ := models.GetUserWithOrg(h.db.DB, stored.UserID)
	tokens, err := h.issueTokens(w, user)
	if err != nil { InternalError(w, err); return }

	OK(w, map[string]any{"accessToken": tokens[0], "expiresIn": 900})
}

// ── Logout ────────────────────────────────────────────────────────────────────

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie("vf_refresh"); err == nil {
		hash := auth.HashToken(cookie.Value)
		h.db.Exec(`DELETE FROM refresh_tokens WHERE token_hash = ?`, hash)
	}
	http.SetCookie(w, &http.Cookie{Name: "vf_refresh", Value: "", MaxAge: -1, Path: "/api/v1/auth"})
	OK(w, map[string]any{"success": true})
}

// ── Verify email ──────────────────────────────────────────────────────────────

func (h *AuthHandler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	user, err := models.GetUserByVerifyToken(h.db.DB, token)
	if err != nil { BadRequest(w, "invalid or expired token"); return }
	h.db.Exec(`UPDATE users SET email_verified = TRUE, verify_token = NULL WHERE id = ?`, user.ID)
	http.Redirect(w, r, h.appURL+"/?verified=1", http.StatusFound)
}

// ── Forgot / reset password ───────────────────────────────────────────────────

func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var body struct{ Email string `json:"email"` }
	Decode(r, &body)
	user, err := models.GetUserByEmail(h.db.DB, strings.ToLower(body.Email))
	if err == nil {
		token := randHex(32)
		expiry := time.Now().Add(time.Hour)
		h.db.Exec(`UPDATE users SET reset_token = ?, reset_expiry = ? WHERE id = ?`, token, expiry, user.ID)
		log.Info().Msgf("PASSWORD RESET for %s: %s/reset-password?token=%s", body.Email, h.appURL, token)
	}
	OK(w, map[string]any{"message": "if that email exists, a reset link has been sent"})
}

func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := Decode(r, &body); err != nil { BadRequest(w, "invalid JSON"); return }
	if len(body.Password) < 8 { BadRequest(w, "password too short"); return }

	user, err := models.GetUserByResetToken(h.db.DB, body.Token)
	if err != nil { BadRequest(w, "invalid or expired reset token"); return }

	hash, _ := bcrypt.GenerateFromPassword([]byte(body.Password), 12)
	h.db.Exec(`UPDATE users SET password_hash = ?, reset_token = NULL, reset_expiry = NULL WHERE id = ?`, string(hash), user.ID)
	h.db.Exec(`DELETE FROM refresh_tokens WHERE user_id = ?`, user.ID)
	OK(w, map[string]any{"message": "password reset successfully"})
}

// ── Me ────────────────────────────────────────────────────────────────────────

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	user, err := models.GetUserWithOrg(h.db.DB, claims.UserID)
	if err != nil { NotFound(w, "user not found"); return }
	OK(w, user.Safe())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func (h *AuthHandler) issueTokens(w http.ResponseWriter, user *models.User) ([]string, error) {
	if user == nil { return nil, fmt.Errorf("nil user") }
	orgID := user.OrgID
	role := user.Role
	access, err := h.jwt.SignAccess(user.ID, user.Email, orgID, role)
	if err != nil { return nil, err }

	rawRefresh, hashRefresh := auth.NewRefreshToken()
	expiresAt := time.Now().Add(h.jwt.RefreshTTL())
	h.db.Exec(
		`INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, NOW())`,
		newID(), user.ID, hashRefresh, expiresAt,
	)

	secure := false // dev: false; prod: true
	http.SetCookie(w, &http.Cookie{
		Name:     "vf_refresh",
		Value:    rawRefresh,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(h.jwt.RefreshTTL().Seconds()),
		Path:     "/api/v1/auth",
	})
	return []string{access, rawRefresh}, nil
}

func newID() string {
	b := make([]byte, 12)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func randHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func slugify(s string) string {
	s = strings.ToLower(s)
	var out []byte
	for _, c := range []byte(s) {
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
			out = append(out, c)
		} else {
			if len(out) > 0 && out[len(out)-1] != '-' {
				out = append(out, '-')
			}
		}
	}
	// Trim trailing dash
	for len(out) > 0 && out[len(out)-1] == '-' {
		out = out[:len(out)-1]
	}
	if len(out) > 60 { out = out[:60] }
	return string(out)
}

func isNotFound(err error) bool {
	return err == sql.ErrNoRows
}
