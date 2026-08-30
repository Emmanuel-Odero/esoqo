// Package httpapi is the Gin HTTP layer: router wiring, middleware, and
// the Phase 0 auth handlers (OTP, PIN sign-in, session, /me).
package httpapi

import (
	"net"
	"time"

	"github.com/gin-contrib/cors"
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
	r.Use(gin.Recovery(), requestLogger(), s.corsMiddleware())

	r.GET("/health", s.handleHealth)
	r.GET("/ready", s.handleReady)

	v1 := r.Group("/v1")
	{
		auth := v1.Group("/auth")
		auth.POST("/otp", s.handleIssueOtp)
		auth.POST("/verify-otp", s.handleVerifyOtp)
		auth.POST("/sign-in", s.handleSignIn)
		auth.POST("/pin/reset", s.handleResetPin)
		auth.POST("/set-pin", s.authRequired(), s.handleSetPin)
		auth.POST("/sign-out", s.authRequired(), s.handleSignOut)

		v1.GET("/me", s.authRequired(), s.handleMe)
	}

	return r
}

// corsMiddleware exists only for the Flutter *web* target — native
// iOS/Android builds never send an Origin header, so CORS is a no-op for
// them either way. Dev defaults to allowing any origin (this is a
// mobile-first API with no cookies to leak — the bearer token lives in
// the client's own storage, not an ambient credential a hostile page
// could ride on); production requires CORS_ALLOWED_ORIGINS to be set
// explicitly, same dev-safe-by-default pattern as the SMS/M-Pesa
// provider gating elsewhere in this service.
func (s *Server) corsMiddleware() gin.HandlerFunc {
	origins := s.Cfg.CORSAllowedOrigins
	if len(origins) == 0 {
		if config.CurrentAppEnv() == config.AppEnvDevelopment {
			origins = []string{"*"}
		} else {
			return func(c *gin.Context) { c.Next() } // no cross-origin access until configured
		}
	}
	cfg := cors.Config{
		AllowOrigins:     origins,
		AllowMethods:     []string{"GET", "POST", "OPTIONS"},
		AllowHeaders:     []string{"Authorization", "Content-Type"},
		AllowCredentials: false, // bearer token, not a cookie — nothing ambient to protect
		MaxAge:           12 * time.Hour,
	}
	if len(origins) == 1 && origins[0] == "*" {
		cfg.AllowOrigins = nil
		cfg.AllowAllOrigins = true
	}
	return cors.New(cfg)
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
