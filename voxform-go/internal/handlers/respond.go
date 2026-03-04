package handlers

import (
	"encoding/json"
	"net/http"
)

func JSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{
		"success": status < 400,
		"data":    data,
	})
}

func OK(w http.ResponseWriter, data any) { JSON(w, 200, data) }

func Created(w http.ResponseWriter, data any) { JSON(w, 201, data) }

func Err(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{
		"success": false,
		"message": msg,
	})
}

func BadRequest(w http.ResponseWriter, msg string)  { Err(w, 400, msg) }
func Unauthorized(w http.ResponseWriter)             { Err(w, 401, "unauthorized") }
func Forbidden(w http.ResponseWriter)                { Err(w, 403, "forbidden") }
func NotFound(w http.ResponseWriter, msg string)     { Err(w, 404, msg) }
func Conflict(w http.ResponseWriter, msg string)     { Err(w, 409, msg) }
func InternalError(w http.ResponseWriter, err error) {
	Err(w, 500, "internal server error")
}

func Decode(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}
