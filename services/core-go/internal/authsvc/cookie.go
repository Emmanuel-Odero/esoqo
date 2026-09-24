package authsvc

import (
	"net/http"
	"time"
)

// CookieName returns the cookie name to use for a given org type's session.
// For backward compatibility during migration:
// - Courier uses "esoqo_parcel_org_session"
// - Other org types use a generic "esoqo_org_session"
func CookieName(orgType string) string {
	if orgType == "courier" {
		return "esoqo_parcel_org_session"
	}
	return "esoqo_org_session"
}

// SetSessionCookie creates and sets a session cookie with appropriate security properties.
func SetSessionCookie(w http.ResponseWriter, token string, data SessionData, maxAge time.Duration) {
	cookieName := CookieName(data.OrgType)

	cookie := &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(maxAge.Seconds()),
		HttpOnly: true,
		Secure:   true, // Always HTTPS in production
		SameSite: http.SameSiteLaxMode,
	}
	http.SetCookie(w, cookie)
}

// SetPersonalSessionCookie sets the personal account session cookie.
func SetPersonalSessionCookie(w http.ResponseWriter, token string, maxAge time.Duration) {
	cookie := &http.Cookie{
		Name:     "esoqo_session",
		Value:    token,
		Path:     "/",
		MaxAge:   int(maxAge.Seconds()),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	}
	http.SetCookie(w, cookie)
}

// ClearSessionCookie clears a session cookie by name.
func ClearSessionCookie(w http.ResponseWriter, cookieName string) {
	cookie := &http.Cookie{
		Name:     cookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	}
	http.SetCookie(w, cookie)
}

// ClearOrgSessionCookie clears the org session cookie for any org type.
func ClearOrgSessionCookie(w http.ResponseWriter, orgType string) {
	ClearSessionCookie(w, CookieName(orgType))
}

// ClearAllSessionCookies clears all session cookies.
func ClearAllSessionCookies(w http.ResponseWriter) {
	ClearSessionCookie(w, "esoqo_session")
	ClearSessionCookie(w, "esoqo_parcel_org_session")
	ClearSessionCookie(w, "esoqo_org_session")
}
