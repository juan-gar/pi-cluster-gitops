package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

const sessionCookie = "reader_session"

// Auth is a single shared passphrase. The session cookie is an HMAC derived
// from it, so there is no session table to persist, and changing the
// passphrase (in 1Password) logs every device out.
type Auth struct {
	passHash [32]byte
	token    string

	// Failed logins sleep while holding this lock, so guesses are serialised
	// to roughly one per failDelay no matter how many arrive in parallel.
	failMu    sync.Mutex
	failDelay time.Duration
}

func NewAuth(passphrase string) *Auth {
	mac := hmac.New(sha256.New, []byte(passphrase))
	mac.Write([]byte("book-reader session v1"))
	return &Auth{
		passHash:  sha256.Sum256([]byte(passphrase)),
		token:     hex.EncodeToString(mac.Sum(nil)),
		failDelay: time.Second,
	}
}

func (a *Auth) authenticated(r *http.Request) bool {
	c, err := r.Cookie(sessionCookie)
	return err == nil && hmac.Equal([]byte(c.Value), []byte(a.token))
}

// RequireAuth rejects requests without a valid session. Mutating requests
// must also carry X-Reader: 1. SameSite=Strict already stops cross-site
// forms, but *.home.juangar.com siblings count as the same site, and a
// custom header can't be sent cross-origin without a CORS preflight we
// never answer.
func (a *Auth) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.authenticated(r) {
			writeError(w, http.StatusUnauthorized, "Sesión no iniciada")
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get("X-Reader") != "1" {
			writeError(w, http.StatusForbidden, "Falta la cabecera X-Reader")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *Auth) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Reader") != "1" {
		writeError(w, http.StatusForbidden, "Falta la cabecera X-Reader")
		return
	}
	var body struct {
		Passphrase string `json:"passphrase"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Petición no válida")
		return
	}
	got := sha256.Sum256([]byte(body.Passphrase))
	if !hmac.Equal(got[:], a.passHash[:]) {
		a.failMu.Lock()
		time.Sleep(a.failDelay)
		a.failMu.Unlock()
		writeError(w, http.StatusUnauthorized, "Contraseña incorrecta")
		return
	}
	http.SetCookie(w, a.cookie(r, a.token, 400*24*60*60))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *Auth) handleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, a.cookie(r, "", -1))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *Auth) cookie(r *http.Request, value string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     sessionCookie,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		// TLS ends at Envoy. Mark the cookie Secure only when the browser
		// actually used https, or login would silently fail on books.lan.
		Secure: r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https",
	}
}
