// Package httpapi is the Gin HTTP layer: router wiring, middleware, and
// the Phase 0 auth handlers (OTP, PIN sign-in, session, /me).
package httpapi

import (
	"net"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/esoko/core-go/internal/authsvc"
	"github.com/esoko/core-go/internal/config"
)

type Server struct {
	Cfg     config.Config
	Pool    *pgxpool.Pool
	Redis   *redis.Client
	OTP     *authsvc.OtpService
	Session *authsvc.SessionService
}

func NewServer(cfg config.Config, pool *pgxpool.Pool, rdb *redis.Client) *Server {
	return &Server{
		Cfg:     cfg,
		Pool:    pool,
		Redis:   rdb,
		OTP:     authsvc.NewOtpService(rdb, cfg.OTPPepper, cfg.OTPDailySpendCapKES, cfg.OTPRateLimitPerHour),
		Session: authsvc.NewSessionService(rdb),
	}
}

func (s *Server) Router() *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery(), requestLogger())

	r.GET("/health", s.handleHealth)
	r.GET("/ready", s.handleReady)

	v1 := r.Group("/v1")
	{
		auth := v1.Group("/auth")
		auth.POST("/otp", s.handleIssueOtp)
		auth.POST("/verify-otp", s.handleVerifyOtp)
		auth.POST("/sign-in", s.handleSignIn)
		auth.POST("/set-pin", s.authRequired(), s.handleSetPin)
		auth.POST("/sign-out", s.authRequired(), s.handleSignOut)

		v1.GET("/me", s.authRequired(), s.handleMe)
	}

	return r
}

func requestLogger() gin.HandlerFunc {
	return gin.LoggerWithFormatter(func(p gin.LogFormatterParams) string {
		return "" // structured logging arrives with Phase 1; keep Phase 0 quiet
	})
}

// clientIP prefers Gin's own resolution (respects trusted proxy config)
// over trusting a raw header.
func clientIP(c *gin.Context) string {
	ip := c.ClientIP()
	if net.ParseIP(ip) == nil {
		return ""
	}
	return ip
}

func writeError(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{"error": gin.H{"code": code, "message": message}})
}
