package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// requestLogger produced an empty string for all of Phase 0 — core-go
// logged nothing at all. Assert it now emits a usable line.
func TestRequestLoggerEmitsALine(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var buf strings.Builder
	gin.DefaultWriter = &buf

	r := gin.New()
	r.Use(requestLogger())
	r.GET("/v1/things/:id", func(c *gin.Context) { c.Status(204) })

	req := httptest.NewRequest("GET", "/v1/things/secret-parcel-code?pin=1234", nil)
	r.ServeHTTP(httptest.NewRecorder(), req)

	out := buf.String()
	if out == "" {
		t.Fatal("requestLogger emitted nothing")
	}
	for _, want := range []string{"GET", "204", "/v1/things/:id"} {
		if !strings.Contains(out, want) {
			t.Errorf("log line %q missing %q", out, want)
		}
	}
	// Credentials and identifiers must not be in the log.
	for _, leak := range []string{"pin=1234", "1234", "secret-parcel-code"} {
		if strings.Contains(out, leak) {
			t.Errorf("log line %q leaked %q", out, leak)
		}
	}
}
