package main

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// Limits on what a bundle may expand to. The request-size cap stops a big
// upload; these stop a small zip that inflates into something huge.
type Limits struct {
	Upload   int64 // request body, bytes
	Entries  int   // files in the zip
	Unpacked int64 // total uncompressed bytes
	BookJSON int64 // book.json alone
}

var DefaultLimits = Limits{
	Upload:   50 << 20,
	Entries:  2000,
	Unpacked: 200 << 20,
	BookJSON: 32 << 20,
}

// badBundle is an error in what the user uploaded rather than in the server.
// Its message is shown in the UI.
type badBundle struct{ msg string }

func (e badBundle) Error() string { return e.msg }

func bad(format string, args ...any) error { return badBundle{fmt.Sprintf(format, args...)} }

// Unpack extracts a bundle zip into dst (an empty directory) and returns
// the parsed, validated book. Only book.json and image files under assets/
// are written; anything else in the zip is ignored, except that an unsafe
// path anywhere fails the whole upload.
func Unpack(zr *zip.Reader, dst string, lim Limits) (*Book, error) {
	if len(zr.File) > lim.Entries {
		return nil, bad("el zip tiene demasiados ficheros (%d, máximo %d)", len(zr.File), lim.Entries)
	}
	prefix := bundlePrefix(zr)

	var total int64
	sawBook := false
	for _, f := range zr.File {
		if ignoredEntry(f.Name) || f.FileInfo().IsDir() {
			continue
		}
		if f.Mode()&fs.ModeSymlink != 0 {
			return nil, bad("el zip contiene un enlace simbólico: %s", f.Name)
		}
		if !safeRel(f.Name) {
			return nil, bad("ruta no permitida en el zip: %s", f.Name)
		}
		rel, ok := strings.CutPrefix(f.Name, prefix)
		if !ok {
			continue
		}

		limit := lim.Unpacked - total
		switch {
		case rel == "book.json":
			sawBook = true
			limit = min(limit, lim.BookJSON)
		case strings.HasPrefix(rel, "assets/"):
			if _, err := assetPath(rel); err != nil {
				return nil, badBundle{err.Error()}
			}
		default:
			continue
		}

		n, err := extractEntry(f, filepath.Join(dst, filepath.FromSlash(rel)), limit)
		if err != nil {
			return nil, err
		}
		total += n
	}
	if !sawBook {
		return nil, bad("el zip no contiene book.json")
	}

	raw, err := os.ReadFile(filepath.Join(dst, "book.json"))
	if err != nil {
		return nil, err
	}
	b, err := ParseBook(raw)
	if err != nil {
		return nil, badBundle{err.Error()}
	}
	if b.Cover != "" {
		if _, err := os.Stat(filepath.Join(dst, filepath.FromSlash(b.Cover))); err != nil {
			return nil, bad("cover %q no está en el zip", b.Cover)
		}
	}
	return b, nil
}

// bundlePrefix lets a zip hold book.json either at its root or inside one
// top-level folder - Finder's "Compress" on a folder produces the latter.
func bundlePrefix(zr *zip.Reader) string {
	prefix := ""
	for _, f := range zr.File {
		if ignoredEntry(f.Name) {
			continue
		}
		if f.Name == "book.json" {
			return ""
		}
		if dir, ok := strings.CutSuffix(f.Name, "/book.json"); ok && !strings.Contains(dir, "/") && prefix == "" {
			prefix = dir + "/"
		}
	}
	return prefix
}

// macOS litter that Finder adds to every zip it makes.
func ignoredEntry(name string) bool {
	return strings.HasPrefix(name, "__MACOSX/") || path.Base(name) == ".DS_Store"
}

// extractEntry writes one zip entry, refusing to exceed limit bytes. The
// limit is enforced on the bytes actually inflated, not on the size the
// zip header claims - a zip bomb lies in its header.
func extractEntry(f *zip.File, target string, limit int64) (int64, error) {
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return 0, err
	}
	rc, err := f.Open()
	if err != nil {
		return 0, bad("no se puede leer %s del zip: %v", f.Name, err)
	}
	defer rc.Close()

	// O_EXCL: a zip that names the same file twice is rejected rather than
	// letting the second copy overwrite the first.
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if errors.Is(err, fs.ErrExist) {
		return 0, bad("fichero repetido en el zip: %s", f.Name)
	}
	if err != nil {
		return 0, err
	}
	n, err := io.Copy(out, io.LimitReader(rc, limit+1))
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return n, bad("zip dañado en %s: %v", f.Name, err)
	}
	if n > limit {
		return n, bad("el zip descomprimido es demasiado grande (en %s)", f.Name)
	}
	return n, nil
}
