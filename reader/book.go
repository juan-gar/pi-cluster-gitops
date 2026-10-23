package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Book is the on-disk book.json, the same shape the original single-file
// reader used for its BOOKS constants. FORMAT.md documents it for whoever
// converts a book; keep the two in step.
type Book struct {
	ID         string    `json:"id"`
	Title      string    `json:"title"`
	ShortTitle string    `json:"shortTitle,omitempty"`
	Author     string    `json:"author,omitempty"`
	Part       string    `json:"part,omitempty"`
	Cover      string    `json:"cover,omitempty"`
	Sections   []Section `json:"sections"`
}

type Section struct {
	Name     string    `json:"name"`
	Kicker   string    `json:"kicker,omitempty"`
	Color    string    `json:"color,omitempty"`
	Articles []Article `json:"articles"`
}

type Article struct {
	Title    string `json:"title"`
	Kicker   string `json:"kicker,omitempty"`
	Subtitle string `json:"subtitle,omitempty"`
	Pages    string `json:"pages,omitempty"`
	Content  string `json:"content"`
}

// Summary is what the library screen needs: enough to draw a card and say
// where you left off, without shipping every book's full text.
type Summary struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	ShortTitle string   `json:"shortTitle,omitempty"`
	Author     string   `json:"author,omitempty"`
	Part       string   `json:"part,omitempty"`
	Cover      string   `json:"cover,omitempty"`
	Titles     []string `json:"titles"`
}

var (
	idRe    = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)
	colorRe = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
)

// Image types only. SVG is deliberately absent: it can carry script, and
// assets are served from the reader's own origin.
var assetTypes = map[string]string{
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".png":  "image/png",
	".webp": "image/webp",
	".gif":  "image/gif",
	".avif": "image/avif",
}

// ParseBook decodes and validates book.json. Unknown fields are an error so
// a typo in a hand- or Claude-converted book ("subtitel") fails loudly at
// upload instead of silently rendering nothing.
func ParseBook(raw []byte) (*Book, error) {
	// encoding/json quietly swaps invalid UTF-8 for U+FFFD, so check first.
	if !utf8.Valid(raw) {
		return nil, errors.New("book.json no es UTF-8 válido")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var b Book
	if err := dec.Decode(&b); err != nil {
		return nil, fmt.Errorf("book.json: %w", err)
	}
	if dec.More() {
		return nil, errors.New("book.json: contenido extra tras el objeto")
	}
	if err := b.validate(); err != nil {
		return nil, err
	}
	return &b, nil
}

func (b *Book) validate() error {
	if !idRe.MatchString(b.ID) {
		return fmt.Errorf("id %q no válido: solo minúsculas, cifras y guiones, hasta 40", b.ID)
	}
	if strings.TrimSpace(b.Title) == "" {
		return errors.New("falta title")
	}
	if b.Cover != "" {
		if _, err := assetPath(b.Cover); err != nil {
			return fmt.Errorf("cover: %w", err)
		}
	}
	if len(b.Sections) == 0 {
		return errors.New("el libro no tiene secciones")
	}
	for i, s := range b.Sections {
		where := fmt.Sprintf("sections[%d]", i)
		if strings.TrimSpace(s.Name) == "" {
			return fmt.Errorf("%s: falta name", where)
		}
		if s.Color != "" && !colorRe.MatchString(s.Color) {
			return fmt.Errorf("%s: color %q debe ser #RRGGBB", where, s.Color)
		}
		if len(s.Articles) == 0 {
			return fmt.Errorf("%s (%s): no tiene artículos", where, s.Name)
		}
		for j, a := range s.Articles {
			where := fmt.Sprintf("sections[%d].articles[%d]", i, j)
			if strings.TrimSpace(a.Title) == "" {
				return fmt.Errorf("%s: falta title", where)
			}
			if strings.TrimSpace(a.Content) == "" {
				return fmt.Errorf("%s (%s): falta content", where, a.Title)
			}
		}
	}
	return nil
}

func (b *Book) Summary() Summary {
	s := Summary{
		ID: b.ID, Title: b.Title, ShortTitle: b.ShortTitle,
		Author: b.Author, Part: b.Part, Cover: b.Cover,
		Titles: []string{},
	}
	for _, sec := range b.Sections {
		for _, a := range sec.Articles {
			s.Titles = append(s.Titles, a.Title)
		}
	}
	return s
}

// assetPath checks a bundle-relative asset path ("assets/cover.jpg") and
// returns its content type. It is the one gate for both zip entries and
// the cover field, so the rules can't drift between them.
func assetPath(p string) (string, error) {
	if !safeRel(p) || !strings.HasPrefix(p, "assets/") || p == "assets/" {
		return "", fmt.Errorf("ruta %q no válida: debe estar dentro de assets/", p)
	}
	ct, ok := assetTypes[strings.ToLower(path.Ext(p))]
	if !ok {
		return "", fmt.Errorf("%q: solo se admiten imágenes jpg, png, webp, gif o avif", p)
	}
	return ct, nil
}

// safeRel reports whether p is a clean, relative, slash-separated path that
// stays inside its root: no "..", no ".", no leading slash, no backslashes.
func safeRel(p string) bool {
	if p == "" || strings.ContainsAny(p, "\\\x00:") || strings.HasPrefix(p, "/") {
		return false
	}
	if path.Clean(p) != p {
		return false
	}
	for _, part := range strings.Split(p, "/") {
		if part == ".." || part == "." {
			return false
		}
	}
	return true
}
