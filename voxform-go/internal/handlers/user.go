package handlers

import (
	"net/http"

	"github.com/voxform/api/internal/db"
	"github.com/voxform/api/internal/middleware"
	"github.com/voxform/api/internal/models"
)

type UserHandler struct{ db *db.DB }

func NewUserHandler(database *db.DB) *UserHandler { return &UserHandler{db: database} }

func (h *UserHandler) Me(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	user, err := models.GetUserWithOrg(h.db.DB, claims.UserID)
	if err != nil { NotFound(w, "user not found"); return }
	OK(w, user.Safe())
}

func (h *UserHandler) Update(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	var body struct {
		Name        *string      `json:"name"`
		AvatarURL   *string      `json:"avatarUrl"`
		Preferences models.JSON  `json:"preferences"`
	}
	if err := Decode(r, &body); err != nil { BadRequest(w, "invalid JSON"); return }

	if body.Name != nil {
		h.db.Exec(`UPDATE users SET name = ?, updated_at = NOW() WHERE id = ?`, *body.Name, claims.UserID)
	}
	if body.AvatarURL != nil {
		h.db.Exec(`UPDATE users SET avatar_url = ?, updated_at = NOW() WHERE id = ?`, *body.AvatarURL, claims.UserID)
	}
	if body.Preferences != nil {
		h.db.Exec(`UPDATE users SET preferences = ?, updated_at = NOW() WHERE id = ?`, string(body.Preferences), claims.UserID)
	}

	user, _ := models.GetUserWithOrg(h.db.DB, claims.UserID)
	OK(w, user.Safe())
}

func (h *UserHandler) OrgMembers(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	members, err := models.GetOrgMembers(h.db.DB, claims.OrgID)
	if err != nil { InternalError(w, err); return }
	OK(w, members)
}
