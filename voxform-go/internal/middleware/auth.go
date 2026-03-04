package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/voxform/api/internal/auth"
)

type contextKey string

const ClaimsKey contextKey = "claims"

// Authenticate validates the Bearer token and stores claims in context.
func Authenticate(jwtSvc *auth.JWTService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if !strings.HasPrefix(header, "Bearer ") {
				http.Error(w, `{"message":"missing or invalid Authorization header"}`, http.StatusUnauthorized)
				return
			}
			token := strings.TrimPrefix(header, "Bearer ")
			claims, err := jwtSvc.Verify(token)
			if err != nil {
				http.Error(w, `{"message":"token expired or invalid"}`, http.StatusUnauthorized)
				return
			}
			ctx := context.WithValue(r.Context(), ClaimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetClaims retrieves JWT claims from the request context.
func GetClaims(r *http.Request) *auth.Claims {
	c, _ := r.Context().Value(ClaimsKey).(*auth.Claims)
	return c
}
