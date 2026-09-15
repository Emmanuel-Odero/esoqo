package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
)

// rateLimit returns middleware bounding how often one client may call a
// route, keyed on the trusted client address (see clientIP).
//
// This is the transport-level bound that per-account lockouts don't
// provide. Money endpoints had none at all, so an STK push, a parcel
// payment or a voucher load could be driven in a tight loop — each one
// costing a real Daraja call, and in the auth case letting a 4-digit PIN
// be ground down over time without ever tripping a per-account counter.
//
// A request whose IP cannot be trusted is allowed through rather than
// bucketed together with every other untrusted request: a shared bucket
// would let one caller lock out everyone behind the same edge. Those
// requests are still covered by whatever per-account or per-resource
// limit the handler applies.
func (s *Server) rateLimit(name string, limit int, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := clientIP(c)
		if ip == "" {
			c.Next()
			return
		}
		err := authsvc.CheckRateLimit(c.Request.Context(), s.Redis, name+":ip:"+ip, limit, window)
		if err != nil {
			if rl, ok := err.(*authsvc.RateLimitError); ok {
				retryAfter := rl.RetryAfterSeconds
				if retryAfter <= 0 {
					retryAfter = int(window.Seconds())
				}
				c.Header("Retry-After", strconv.Itoa(retryAfter))
				writeError(c, http.StatusTooManyRequests, "RATE_LIMITED",
					"Too many requests. Please wait a moment and try again.")
				c.Abort()
				return
			}
			// Redis trouble must not become an outage on payment and
			// sign-in paths; the limit is a guard, not the gate.
			c.Next()
			return
		}
		c.Next()
	}
}
