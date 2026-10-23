package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const testPass = "correct horse"

const sampleBook = `{
  "id": "prueba",
  "title": "Libro de prueba",
  "author": "Autora",
  "cover": "assets/cover.png",
  "sections": [
    {"name": "Capítulos", "color": "#2F5D7C", "articles": [
      {"title": "Uno", "kicker": "Capítulo 1", "content": "Hola.\n\n@sep\n\nAdiós [1]."},
      {"title": "Dos", "content": "Segundo."}
    ]},
    {"name": "Notas", "articles": [{"title": "Notas", "content": "[1] Una nota."}]}
  ]
}`

type entry struct {
	name string
	body string
	mode fs.FileMode
}

func makeZip(t *testing.T, entries ...entry) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range entries {
		h := &zip.FileHeader{Name: e.name, Method: zip.Deflate}
		if e.mode != 0 {
			h.SetMode(e.mode)
		}
		w, err := zw.CreateHeader(h)
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(e.body))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func validZip(t *testing.T) []byte {
	return makeZip(t, entry{name: "book.json", body: sampleBook}, entry{name: "assets/cover.png", body: "png"})
}

type harness struct {
	t      *testing.T
	srv    *Server
	h      http.Handler
	dir    string
	cookie *http.Cookie
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	dir := t.TempDir()
	store, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	auth := NewAuth(testPass)
	auth.failDelay = 0
	srv := NewServer(store, auth, t.TempDir())
	hs := &harness{t: t, srv: srv, h: srv.Routes(), dir: dir}
	hs.cookie = &http.Cookie{Name: sessionCookie, Value: auth.token}
	return hs
}

// do sends an authenticated request (with the X-Reader header) unless
// opts say otherwise.
func (hs *harness) do(method, target string, body []byte, opts ...string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, bytes.NewReader(body))
	noAuth, noHeader := false, false
	for _, o := range opts {
		noAuth = noAuth || o == "noauth"
		noHeader = noHeader || o == "noheader"
	}
	if !noAuth {
		req.AddCookie(hs.cookie)
	}
	if !noHeader {
		req.Header.Set("X-Reader", "1")
	}
	rec := httptest.NewRecorder()
	hs.h.ServeHTTP(rec, req)
	return rec
}

func (hs *harness) expect(rec *httptest.ResponseRecorder, code int) {
	hs.t.Helper()
	if rec.Code != code {
		hs.t.Fatalf("status %d, want %d: %s", rec.Code, code, rec.Body.String())
	}
}

func TestUploadReadDelete(t *testing.T) {
	hs := newHarness(t)
	hs.expect(hs.do("POST", "/api/books", validZip(t)), http.StatusCreated)

	rec := hs.do("GET", "/api/books", nil)
	hs.expect(rec, http.StatusOK)
	var list []Summary
	json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list) != 1 || list[0].ID != "prueba" || len(list[0].Titles) != 3 {
		t.Fatalf("unexpected list: %+v", list)
	}

	rec = hs.do("GET", "/api/books/prueba", nil)
	hs.expect(rec, http.StatusOK)
	if !strings.Contains(rec.Body.String(), "Adiós [1].") {
		t.Fatalf("book body missing content: %s", rec.Body.String())
	}

	rec = hs.do("GET", "/api/books/prueba/assets/cover.png", nil)
	hs.expect(rec, http.StatusOK)
	if rec.Header().Get("Content-Type") != "image/png" || rec.Body.String() != "png" {
		t.Fatalf("asset: %q %q", rec.Header().Get("Content-Type"), rec.Body.String())
	}

	hs.expect(hs.do("PUT", "/api/progress/prueba", []byte(`{"idx":1,"para":4}`)), http.StatusOK)
	hs.expect(hs.do("DELETE", "/api/books/prueba", nil), http.StatusOK)
	hs.expect(hs.do("GET", "/api/books/prueba", nil), http.StatusNotFound)
	if p := hs.srv.store.Progress(); len(p.Books) != 0 || p.Last != "" {
		t.Fatalf("progress not cleared on delete: %+v", p)
	}
}

func TestUploadInsideFolderIgnoresMacJunk(t *testing.T) {
	hs := newHarness(t)
	z := makeZip(t,
		entry{name: "Mi libro/book.json", body: sampleBook},
		entry{name: "Mi libro/assets/cover.png", body: "png"},
		entry{name: "Mi libro/README.md", body: "ignored"},
		entry{name: "__MACOSX/Mi libro/._book.json", body: "junk"},
		entry{name: "Mi libro/.DS_Store", body: "junk"},
	)
	hs.expect(hs.do("POST", "/api/books", z), http.StatusCreated)
	if _, err := os.Stat(filepath.Join(hs.dir, "books", "prueba", "README.md")); err == nil {
		t.Fatal("non-bundle file was extracted")
	}
}

func TestReplace(t *testing.T) {
	hs := newHarness(t)
	hs.expect(hs.do("POST", "/api/books", validZip(t)), http.StatusCreated)
	rec := hs.do("POST", "/api/books", validZip(t))
	hs.expect(rec, http.StatusConflict)
	if !strings.Contains(rec.Body.String(), "Libro de prueba") {
		t.Fatalf("conflict should name the existing book: %s", rec.Body.String())
	}
	updated := strings.Replace(sampleBook, "Libro de prueba", "Segunda edición", 1)
	z := makeZip(t, entry{name: "book.json", body: updated}, entry{name: "assets/cover.png", body: "png"})
	hs.expect(hs.do("POST", "/api/books?replace=1", z), http.StatusCreated)
	if !strings.Contains(hs.do("GET", "/api/books/prueba", nil).Body.String(), "Segunda edición") {
		t.Fatal("replace did not take effect")
	}
	if entries, _ := os.ReadDir(filepath.Join(hs.dir, "tmp")); len(entries) != 0 {
		t.Fatalf("tmp not cleaned up: %v", entries)
	}
}

func TestUploadRejected(t *testing.T) {
	withField := func(field string) string {
		return strings.Replace(sampleBook, `"author": "Autora",`, `"author": "Autora", `+field+`,`, 1)
	}
	cases := map[string][]byte{
		"traversal":       makeZip(t, entry{name: "book.json", body: sampleBook}, entry{name: "../evil.png", body: "x"}),
		"nested traverse": makeZip(t, entry{name: "book.json", body: sampleBook}, entry{name: "assets/../../evil.png", body: "x"}),
		"absolute":        makeZip(t, entry{name: "book.json", body: sampleBook}, entry{name: "/etc/evil.png", body: "x"}),
		"backslash":       makeZip(t, entry{name: "book.json", body: sampleBook}, entry{name: `assets\..\..\evil.png`, body: "x"}),
		"symlink":         makeZip(t, entry{name: "book.json", body: sampleBook}, entry{name: "assets/cover.png", body: "/etc/passwd", mode: fs.ModeSymlink | 0o777}),
		"svg asset":       makeZip(t, entry{name: "book.json", body: sampleBook}, entry{name: "assets/x.svg", body: "<svg/>"}),
		"duplicate":       makeZip(t, entry{name: "book.json", body: sampleBook}, entry{name: "book.json", body: sampleBook}),
		"no book.json":    makeZip(t, entry{name: "assets/cover.png", body: "png"}),
		"missing cover":   makeZip(t, entry{name: "book.json", body: sampleBook}),
		"bad json":        makeZip(t, entry{name: "book.json", body: `{"id":`}),
		"unknown field":   makeZip(t, entry{name: "book.json", body: withField(`"subtitel": "x"`)}),
		"bad id":          makeZip(t, entry{name: "book.json", body: strings.Replace(sampleBook, `"prueba"`, `"../x"`, 1)}),
		"bad color":       makeZip(t, entry{name: "book.json", body: strings.Replace(sampleBook, "#2F5D7C", "red;x", 1)}),
		"invalid utf8":    makeZip(t, entry{name: "book.json", body: strings.Replace(sampleBook, "Hola", "Ho\xffla", 1)}),
		"no articles":     makeZip(t, entry{name: "book.json", body: `{"id":"x","title":"x","sections":[{"name":"s","articles":[]}]}`}),
		"not a zip":       []byte("hello"),
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			hs := newHarness(t)
			rec := hs.do("POST", "/api/books", body)
			if rec.Code != http.StatusUnprocessableEntity && rec.Code != http.StatusBadRequest {
				t.Fatalf("status %d, want 422/400: %s", rec.Code, rec.Body.String())
			}
			if entries, _ := os.ReadDir(filepath.Join(hs.dir, "books")); len(entries) != 0 {
				t.Fatalf("rejected upload left books behind: %v", entries)
			}
			if _, err := os.Stat(filepath.Join(filepath.Dir(hs.dir), "evil.png")); err == nil {
				t.Fatal("traversal escaped the data dir")
			}
		})
	}
}

func TestUploadLimits(t *testing.T) {
	t.Run("request too large", func(t *testing.T) {
		hs := newHarness(t)
		hs.srv.limits.Upload = 100
		hs.expect(hs.do("POST", "/api/books", validZip(t)), http.StatusRequestEntityTooLarge)
	})
	t.Run("zip bomb", func(t *testing.T) {
		hs := newHarness(t)
		hs.srv.limits.Unpacked = 1 << 10
		// Compresses to almost nothing, inflates past the limit.
		z := makeZip(t, entry{name: "book.json", body: sampleBook}, entry{name: "assets/cover.png", body: strings.Repeat("0", 1<<20)})
		hs.expect(hs.do("POST", "/api/books", z), http.StatusUnprocessableEntity)
	})
	t.Run("too many entries", func(t *testing.T) {
		hs := newHarness(t)
		hs.srv.limits.Entries = 2
		z := makeZip(t, entry{name: "book.json", body: sampleBook}, entry{name: "assets/cover.png", body: "png"}, entry{name: "assets/b.png", body: "b"})
		hs.expect(hs.do("POST", "/api/books", z), http.StatusUnprocessableEntity)
	})
}

func TestAuth(t *testing.T) {
	hs := newHarness(t)
	hs.expect(hs.do("GET", "/api/books", nil, "noauth"), http.StatusUnauthorized)
	hs.expect(hs.do("GET", "/api/progress", nil, "noauth"), http.StatusUnauthorized)
	hs.expect(hs.do("GET", "/api/nope", nil, "noauth"), http.StatusUnauthorized)
	// Logged in, but a mutating request without the header is refused.
	hs.expect(hs.do("POST", "/api/books", validZip(t), "noheader"), http.StatusForbidden)
	hs.expect(hs.do("GET", "/healthz", nil, "noauth"), http.StatusOK)

	hs.expect(hs.do("POST", "/api/login", []byte(`{"passphrase":"wrong"}`), "noauth"), http.StatusUnauthorized)
	hs.expect(hs.do("POST", "/api/login", []byte(`{"passphrase":"`+testPass+`"}`), "noauth", "noheader"), http.StatusForbidden)

	rec := hs.do("POST", "/api/login", []byte(`{"passphrase":"`+testPass+`"}`), "noauth")
	hs.expect(rec, http.StatusOK)
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatalf("bad session cookie: %+v", cookies)
	}
	if cookies[0].Secure {
		t.Fatal("cookie must not be Secure over plain http (books.lan)")
	}
	req := httptest.NewRequest("GET", "/api/books", nil)
	req.AddCookie(cookies[0])
	got := httptest.NewRecorder()
	hs.h.ServeHTTP(got, req)
	hs.expect(got, http.StatusOK)

	// Different passphrase, different token: old cookies stop working.
	if NewAuth("other").token == hs.srv.auth.token {
		t.Fatal("token does not depend on the passphrase")
	}
}

func TestSecureCookieBehindTLS(t *testing.T) {
	hs := newHarness(t)
	req := httptest.NewRequest("POST", "/api/login", strings.NewReader(`{"passphrase":"`+testPass+`"}`))
	req.Header.Set("X-Reader", "1")
	req.Header.Set("X-Forwarded-Proto", "https")
	rec := httptest.NewRecorder()
	hs.h.ServeHTTP(rec, req)
	if c := rec.Result().Cookies(); len(c) != 1 || !c[0].Secure {
		t.Fatalf("cookie should be Secure behind https: %+v", c)
	}
}

func TestProgress(t *testing.T) {
	hs := newHarness(t)
	hs.expect(hs.do("PUT", "/api/progress/prueba", []byte(`{"idx":1,"para":2}`)), http.StatusNotFound)
	hs.expect(hs.do("POST", "/api/books", validZip(t)), http.StatusCreated)
	hs.expect(hs.do("PUT", "/api/progress/prueba", []byte(`{"idx":-1,"para":2}`)), http.StatusBadRequest)
	hs.expect(hs.do("PUT", "/api/progress/prueba", []byte(`{"idx":1,"para":7}`)), http.StatusOK)

	// Survives a restart.
	store, err := NewStore(hs.dir)
	if err != nil {
		t.Fatal(err)
	}
	p := store.Progress()
	if p.Last != "prueba" || p.Books["prueba"].Idx != 1 || p.Books["prueba"].Para != 7 || p.Books["prueba"].At == 0 {
		t.Fatalf("progress not persisted: %+v", p)
	}
}

func TestProgressConcurrentWritesStayValid(t *testing.T) {
	hs := newHarness(t)
	hs.expect(hs.do("POST", "/api/books", validZip(t)), http.StatusCreated)
	var wg sync.WaitGroup
	for i := range 50 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rec := hs.do("PUT", "/api/progress/prueba", []byte(fmt.Sprintf(`{"idx":%d,"para":%d}`, i, i)))
			if rec.Code != http.StatusOK {
				t.Errorf("status %d", rec.Code)
			}
		}()
	}
	wg.Wait()
	raw, err := os.ReadFile(filepath.Join(hs.dir, "progress.json"))
	if err != nil {
		t.Fatal(err)
	}
	var p Progress
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatalf("progress.json corrupt: %v\n%s", err, raw)
	}
	if leftovers, _ := filepath.Glob(filepath.Join(hs.dir, ".progress-*")); len(leftovers) != 0 {
		t.Fatalf("temp files left: %v", leftovers)
	}
}

func TestStartupClearsTmpAndToleratesBadProgress(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "tmp", "book-123"), 0o755)
	os.WriteFile(filepath.Join(dir, "progress.json"), []byte("{trunc"), 0o644)
	store, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if entries, _ := os.ReadDir(filepath.Join(dir, "tmp")); len(entries) != 0 {
		t.Fatal("tmp not cleared at startup")
	}
	if _, err := store.SetSpot("x", 1, 1); err != nil {
		t.Fatal("store unusable after bad progress.json:", err)
	}
}

func TestLoginFailuresAreSerialised(t *testing.T) {
	hs := newHarness(t)
	hs.srv.auth.failDelay = 50 * time.Millisecond
	start := time.Now()
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			hs.do("POST", "/api/login", []byte(`{"passphrase":"nope"}`), "noauth")
		}()
	}
	wg.Wait()
	if elapsed := time.Since(start); elapsed < 200*time.Millisecond {
		t.Fatalf("4 parallel bad logins took %v, want >= 200ms", elapsed)
	}
}

func TestSafeRel(t *testing.T) {
	for p, want := range map[string]bool{
		"book.json": true, "assets/a.png": true, "a/b/c.png": true,
		"": false, "/a": false, "../a": false, "a/../b": false, "./a": false,
		"a//b": false, `a\b`: false, "a/": false, "C:/x": false,
	} {
		if got := safeRel(p); got != want {
			t.Errorf("safeRel(%q) = %v, want %v", p, got, want)
		}
	}
}
