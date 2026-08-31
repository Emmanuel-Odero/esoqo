// Package httpapi is the Gin HTTP layer: router wiring, middleware, and
// the Phase 0 auth handlers (OTP, PIN sign-in, session, /me).
package httpapi

import (
	"net"
	"strconv"
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
		v1.GET("/me/history", s.authRequired(), s.handleHistory)
		v1.GET("/me/points", s.authRequired(), s.handlePoints)

		v1.GET("/stores", s.handleListStores)
		v1.GET("/stores/:slug", s.handleGetStore)
		v1.GET("/stores/:slug/products", s.handleListStoreProducts)
		v1.GET("/products/:id", s.handleGetProduct)
		v1.POST("/orders", s.handleCreateOrder)
		v1.GET("/orders/:id", s.handleGetOrder)
		v1.GET("/me/orders", s.authRequired(), s.handleListMyOrders)

		v1.GET("/listings", s.handleListListings)
		v1.GET("/listings/:id", s.handleGetListing)
		v1.GET("/schedules/:id/seats", s.handleListScheduleSeats)
		v1.POST("/bookings", s.handleCreateBooking)
		v1.GET("/bookings/:id", s.handleGetBooking)
		v1.GET("/me/tickets", s.authRequired(), s.handleListMyBookings)

		v1.POST("/groups", s.authRequired(), s.handleCreateGroup)
		v1.POST("/groups/:id/join", s.authRequired(), s.handleJoinGroup)
		v1.GET("/groups/search", s.authRequired(), s.handleSearchGroups)
		v1.GET("/me/groups", s.authRequired(), s.handleListMyGroups)
		v1.GET("/groups/:id", s.authRequired(), s.handleGetGroup)

		v1.GET("/groups/:id/policy", s.authRequired(), s.handleGetTreasuryPolicy)
		v1.POST("/groups/:id/contributions", s.authRequired(), s.handleDeclareContribution)
		v1.POST("/groups/:id/contributions/:cid/confirm", s.authRequired(), s.handleConfirmContribution)
		v1.GET("/groups/:id/contributions", s.authRequired(), s.handleListContributions)
		v1.GET("/groups/:id/balance", s.authRequired(), s.handleGetGroupBalance)
		v1.POST("/groups/:id/withdrawals", s.authRequired(), s.handleRequestWithdrawal)
		v1.GET("/groups/:id/withdrawals", s.authRequired(), s.handleListWithdrawals)
		v1.POST("/withdrawals/:id/sign", s.authRequired(), s.handleSignWithdrawal)
		v1.GET("/withdrawals/:id", s.authRequired(), s.handleGetWithdrawal)

		v1.POST("/me/bills", s.authRequired(), s.handleCreateBill)
		v1.GET("/me/bills", s.authRequired(), s.handleListMyBills)
		v1.POST("/me/bills/:id/pay", s.authRequired(), s.handleMarkBillPaid)
		v1.PATCH("/me/bills/:id", s.authRequired(), s.handleUpdateBill)
		v1.DELETE("/me/bills/:id", s.authRequired(), s.handleArchiveBill)
	}

	r.POST("/webhooks/mpesa/stk-callback", s.handleMpesaStkCallback)

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

// parseKES parses one of this package's own "%.2f"-formatted KES
// strings (see dbx.CreateStoreOrder/CreateBooking) back into a float
// for the STK push amount. Never fed anything but our own output, so a
// parse failure here is a bug, not user input — hence the 0 fallback
// rather than plumbing an error through every caller.
func parseKES(s string) float64 {
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return f
}
