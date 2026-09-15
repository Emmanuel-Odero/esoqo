package httpapi

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func ipForHeader(t *testing.T, hops int32, xff string) string {
	t.Helper()
	gin.SetMode(gin.TestMode)
	trustedProxyHops.Store(hops)

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "10.0.0.1:1234" // the platform edge, as seen by us
	if xff != "" {
		req.Header.Set("X-Forwarded-For", xff)
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = req
	return clientIP(c)
}

// The bug this closes: reading X-Forwarded-For[0] returns whatever the
// caller prepended, so every request can claim a fresh rate-limit bucket.
func TestClientIPIgnoresCallerSuppliedPrefix(t *testing.T) {
	if got := ipForHeader(t, 1, "1.2.3.4, 41.90.0.7"); got != "41.90.0.7" {
		t.Errorf("clientIP = %q, want the proxy-appended 41.90.0.7", got)
	}
}

func TestClientIPStableAcrossRotatedForgery(t *testing.T) {
	a := ipForHeader(t, 1, "9.9.9.9, 41.90.0.7")
	b := ipForHeader(t, 1, "8.8.8.8, 41.90.0.7")
	if a != b || a != "41.90.0.7" {
		t.Errorf("rotating the forged prefix changed the bucket: %q vs %q", a, b)
	}
}

func TestClientIPSingleHonestHop(t *testing.T) {
	if got := ipForHeader(t, 1, "41.90.0.7"); got != "41.90.0.7" {
		t.Errorf("clientIP = %q, want 41.90.0.7", got)
	}
}

// A chain shorter than the configured hop count means nothing in it is
// verifiably ours — better no IP dimension than a caller-chosen one.
func TestClientIPRefusesShortChain(t *testing.T) {
	if got := ipForHeader(t, 2, "41.90.0.7"); got != "" {
		t.Errorf("clientIP = %q, want empty for an under-length chain", got)
	}
}

func TestClientIPRejectsNonIPValue(t *testing.T) {
	if got := ipForHeader(t, 1, "not-an-ip"); got != "" {
		t.Errorf("clientIP = %q, want empty for a malformed entry", got)
	}
}

// With no proxy in front (hops=0) the header is ignored entirely and the
// direct peer is used.
func TestClientIPNoProxyIgnoresHeader(t *testing.T) {
	if got := ipForHeader(t, 0, "1.2.3.4"); got != "10.0.0.1" {
		t.Errorf("clientIP = %q, want the direct peer 10.0.0.1", got)
	}
}
