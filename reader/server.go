package main

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type Server struct {
	store     *Store
	auth      *Auth
	staticDir string
	limits    Limits
}

func NewServer(store *Store, auth *Auth, staticDir string) *Server {
	return &Server{store: store, auth: auth, staticDir: staticDir, limits: DefaultLimits}
}

func (s *Server) Routes() http.Handler {
	api := http.NewServeMux()
	api.HandleFunc("GET /api/session", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	api.HandleFunc("GET /api/books", s.listBooks)
	api.HandleFunc("POST /api/books", s.uploadBook)
	api.HandleFunc("GET /api/books/{id}", s.getBook)
	api.HandleFunc("DELETE /api/books/{id}", s.deleteBook)
	api.HandleFunc("GET /api/books/{id}/assets/{path...}", s.getAsset)
	api.HandleFunc("GET /api/progress", s.getProgress)
	api.HandleFunc("PUT /api/progress/{id}", s.putProgress)
	api.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "No existe")
	})

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok\n"))
	})
	mux.HandleFunc("POST /api/login", s.auth.handleLogin)
	mux.HandleFunc("POST /api/logout", s.auth.handleLogout)
	mux.Handle("/api/", s.auth.RequireAuth(api))
	// The UI itself is public code, so it needs no login; everything it
	// fetches does.
	mux.Handle("/", s.static())
	return securityHeaders(mux)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		// 'unsafe-inline' for styles only: the reader styles everything with
		// React style attributes, as the original did. No inline script.
		h.Set("Content-Security-Policy",
			"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "+
				"script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

// static serves the Vite build. index.html must always revalidate so a new
// deploy is picked up; files under /assets/ have content hashes in their
// names and can be cached forever.
func (s *Server) static() http.Handler {
	fsrv := http.FileServer(http.Dir(s.staticDir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		fsrv.ServeHTTP(w, r)
	})
}

func (s *Server) listBooks(w http.ResponseWriter, r *http.Request) {
	books, err := s.store.List()
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, books)
}

func (s *Server) getBook(w http.ResponseWriter, r *http.Request) {
	id, ok := bookID(w, r)
	if !ok {
		return
	}
	f, err := os.Open(filepath.Join(s.store.BookDir(id), "book.json"))
	if err != nil {
		writeError(w, http.StatusNotFound, "Ese libro no existe")
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		serverError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-cache")
	// ServeContent answers If-Modified-Since, so a reopened book costs a 304,
	// not the whole text again.
	http.ServeContent(w, r, "book.json", st.ModTime(), f)
}

func (s *Server) getAsset(w http.ResponseWriter, r *http.Request) {
	id, ok := bookID(w, r)
	if !ok {
		return
	}
	rel := "assets/" + r.PathValue("path")
	ct, err := assetPath(rel)
	if err != nil {
		writeError(w, http.StatusNotFound, "No existe")
		return
	}
	// os.Root refuses to follow anything out of the book's directory, on top
	// of the path checks above.
	root, err := os.OpenRoot(s.store.BookDir(id))
	if err != nil {
		writeError(w, http.StatusNotFound, "No existe")
		return
	}
	defer root.Close()
	f, err := root.Open(filepath.FromSlash(rel))
	if err != nil {
		writeError(w, http.StatusNotFound, "No existe")
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		writeError(w, http.StatusNotFound, "No existe")
		return
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "private, no-cache")
	http.ServeContent(w, r, rel, st.ModTime(), f)
}

func (s *Server) uploadBook(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, s.limits.Upload)

	// zip needs random access, so spool the body to disk first. Under tmp/,
	// not /tmp: the root filesystem is read-only in the cluster.
	spool, err := os.CreateTemp(s.store.tmpDir(), "upload-*.zip")
	if err != nil {
		serverError(w, err)
		return
	}
	defer os.Remove(spool.Name())
	defer spool.Close()
	size, err := io.Copy(spool, r.Body)
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "El zip supera el máximo de 50 MB")
			return
		}
		writeError(w, http.StatusBadRequest, "La subida se interrumpió")
		return
	}
	zr, err := zip.NewReader(spool, size)
	if err != nil {
		writeError(w, http.StatusBadRequest, "No es un fichero zip válido")
		return
	}

	staged, err := os.MkdirTemp(s.store.tmpDir(), "book-")
	if err != nil {
		serverError(w, err)
		return
	}
	// After a successful Install staged no longer exists, and this is a no-op.
	defer os.RemoveAll(staged)

	b, err := Unpack(zr, staged, s.limits)
	var bb badBundle
	if errors.As(err, &bb) {
		writeError(w, http.StatusUnprocessableEntity, bb.msg)
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}

	replace := r.URL.Query().Get("replace") == "1"
	err = s.store.Install(staged, b, replace)
	if errors.Is(err, ErrExists) {
		writeJSON(w, http.StatusConflict, map[string]string{
			"error": "Ya hay un libro con ese id", "id": b.ID, "title": b.Title,
		})
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	log.Printf("installed book %s (%q, replace=%v)", b.ID, b.Title, replace)
	writeJSON(w, http.StatusCreated, b.Summary())
}

func (s *Server) deleteBook(w http.ResponseWriter, r *http.Request) {
	id, ok := bookID(w, r)
	if !ok {
		return
	}
	err := s.store.Delete(id)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "Ese libro no existe")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	log.Printf("deleted book %s", id)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) getProgress(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, s.store.Progress())
}

func (s *Server) putProgress(w http.ResponseWriter, r *http.Request) {
	id, ok := bookID(w, r)
	if !ok {
		return
	}
	var body struct {
		Idx  int `json:"idx"`
		Para int `json:"para"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil ||
		body.Idx < 0 || body.Para < 0 || body.Idx > 1e6 || body.Para > 1e6 {
		writeError(w, http.StatusBadRequest, "Posición no válida")
		return
	}
	if !s.store.Exists(id) {
		writeError(w, http.StatusNotFound, "Ese libro no existe")
		return
	}
	spot, err := s.store.SetSpot(id, body.Idx, body.Para)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, spot)
}

func bookID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("id")
	if !idRe.MatchString(id) {
		writeError(w, http.StatusNotFound, "Ese libro no existe")
		return "", false
	}
	return id, true
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func serverError(w http.ResponseWriter, err error) {
	log.Printf("error: %v", err)
	writeError(w, http.StatusInternalServerError, "Error del servidor")
}
