package queue

import (
	"crypto/rand"
	"fmt"
)

func randID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return fmt.Sprintf("%x", b)
}
