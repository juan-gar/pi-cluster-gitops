package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Layout under the data dir:
//
//	books/<id>/book.json
//	books/<id>/assets/...
//	progress.json
//	tmp/            uploads being unpacked; same filesystem, so installs are a rename
type Store struct {
	dir string

	// mu serialises every write: installs, deletes and progress saves.
	// Reads of book files take no lock - an install swaps a whole directory
	// with rename, so a reader sees the old book or the new one, never half.
	mu       sync.Mutex
	progress Progress
}

// Progress is synced across devices. Font size is deliberately not in here:
// it is per device (phone and laptop want different sizes), so the UI keeps
// it in localStorage.
type Progress struct {
	Last  string          `json:"last"`
	Books map[string]Spot `json:"books"`
}

// Spot is a reading position: article index within the book and the first
// visible paragraph. At is server time in Unix ms, so another device can
// tell its own position is stale.
type Spot struct {
	Idx  int   `json:"idx"`
	Para int   `json:"para"`
	At   int64 `json:"at"`
}

var (
	ErrNotFound = errors.New("not found")
	ErrExists   = errors.New("exists")
)

func NewStore(dir string) (*Store, error) {
	s := &Store{dir: dir, progress: Progress{Books: map[string]Spot{}}}
	for _, d := range []string{s.booksDir(), s.tmpDir()} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return nil, err
		}
	}
	// Leftovers from an upload interrupted by a restart.
	if entries, err := os.ReadDir(s.tmpDir()); err == nil {
		for _, e := range entries {
			_ = os.RemoveAll(filepath.Join(s.tmpDir(), e.Name()))
		}
	}
	raw, err := os.ReadFile(s.progressPath())
	switch {
	case errors.Is(err, os.ErrNotExist):
	case err != nil:
		return nil, err
	default:
		if err := json.Unmarshal(raw, &s.progress); err != nil {
			// Not fatal: losing a bookmark beats a reader that won't start.
			log.Printf("progress.json unreadable, starting fresh: %v", err)
			s.progress = Progress{}
		}
		if s.progress.Books == nil {
			s.progress.Books = map[string]Spot{}
		}
	}
	return s, nil
}

func (s *Store) booksDir() string     { return filepath.Join(s.dir, "books") }
func (s *Store) tmpDir() string       { return filepath.Join(s.dir, "tmp") }
func (s *Store) progressPath() string { return filepath.Join(s.dir, "progress.json") }

// BookDir returns the directory of an installed book. id must already have
// passed idRe; the handlers check that before calling.
func (s *Store) BookDir(id string) string { return filepath.Join(s.booksDir(), id) }

func (s *Store) List() ([]Summary, error) {
	entries, err := os.ReadDir(s.booksDir())
	if err != nil {
		return nil, err
	}
	out := []Summary{}
	for _, e := range entries {
		if !e.IsDir() || !idRe.MatchString(e.Name()) {
			continue
		}
		b, err := s.readBook(e.Name())
		if err != nil {
			log.Printf("skipping book %s: %v", e.Name(), err)
			continue
		}
		out = append(out, b.Summary())
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Title) < strings.ToLower(out[j].Title)
	})
	return out, nil
}

func (s *Store) readBook(id string) (*Book, error) {
	raw, err := os.ReadFile(filepath.Join(s.BookDir(id), "book.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return ParseBook(raw)
}

func (s *Store) Exists(id string) bool {
	_, err := os.Stat(filepath.Join(s.BookDir(id), "book.json"))
	return err == nil
}

// Install moves an unpacked, validated bundle from staged (a directory
// under tmp/) into books/<id>. With replace, an existing book is swapped
// out; without it, ErrExists.
func (s *Store) Install(staged string, b *Book, replace bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dest := s.BookDir(b.ID)
	var old string
	if _, err := os.Stat(dest); err == nil {
		if !replace {
			return ErrExists
		}
		old, err = os.MkdirTemp(s.tmpDir(), "old-")
		if err != nil {
			return err
		}
		// MkdirTemp created it; rename needs the target to not exist.
		if err := os.Remove(old); err != nil {
			return err
		}
		if err := os.Rename(dest, old); err != nil {
			return err
		}
	}
	if err := os.Rename(staged, dest); err != nil {
		if old != "" {
			_ = os.Rename(old, dest)
		}
		return err
	}
	if old != "" {
		_ = os.RemoveAll(old)
	}
	return nil
}

func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dest := s.BookDir(id)
	if _, err := os.Stat(dest); err != nil {
		return ErrNotFound
	}
	if err := os.RemoveAll(dest); err != nil {
		return err
	}
	delete(s.progress.Books, id)
	if s.progress.Last == id {
		s.progress.Last = ""
	}
	return s.saveProgressLocked()
}

func (s *Store) Progress() Progress {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := Progress{Last: s.progress.Last, Books: make(map[string]Spot, len(s.progress.Books))}
	for k, v := range s.progress.Books {
		p.Books[k] = v
	}
	return p
}

func (s *Store) SetSpot(id string, idx, para int) (Spot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	spot := Spot{Idx: idx, Para: para, At: time.Now().UnixMilli()}
	s.progress.Books[id] = spot
	s.progress.Last = id
	return spot, s.saveProgressLocked()
}

// saveProgressLocked writes progress.json atomically: a crash or power cut
// mid-write leaves the previous file, never a truncated one. Caller holds mu.
func (s *Store) saveProgressLocked() error {
	raw, err := json.Marshal(s.progress)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(s.dir, ".progress-*.json")
	if err != nil {
		return err
	}
	tmp := f.Name()
	if _, err := f.Write(raw); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, s.progressPath()); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("saving progress: %w", err)
	}
	return nil
}
