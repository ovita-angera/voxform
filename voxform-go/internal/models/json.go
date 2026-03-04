package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
)

// JSON is a []byte that scans from a MySQL JSON column
// and marshals/unmarshals transparently.
type JSON []byte

func (j JSON) MarshalJSON() ([]byte, error) {
	if j == nil {
		return []byte("null"), nil
	}
	return j, nil
}

func (j *JSON) UnmarshalJSON(data []byte) error {
	if j == nil {
		return errors.New("null pointer")
	}
	*j = append((*j)[0:0], data...)
	return nil
}

func (j JSON) Value() (driver.Value, error) {
	if len(j) == 0 {
		return "{}", nil
	}
	return string(j), nil
}

func (j *JSON) Scan(value any) error {
	if value == nil {
		*j = JSON("{}")
		return nil
	}
	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return errors.New("unsupported type for JSON scan")
	}
	*j = append((*j)[0:0], bytes...)
	return nil
}

// Encode marshals any value into a JSON field.
func Encode(v any) (JSON, error) {
	b, err := json.Marshal(v)
	return JSON(b), err
}

// Decode unmarshals a JSON field into v.
func (j JSON) Decode(v any) error {
	if len(j) == 0 {
		return nil
	}
	return json.Unmarshal(j, v)
}
