// Book reader: a private, LAN-only library for books converted to the
// reader's book.json format (see FORMAT.md).
//
// One binary serves the built web UI and a small JSON API. Everything it
// stores lives under READER_DATA_DIR - book text is uploaded at runtime and
// never baked into the image, because the image and this repo are public.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	addr := envOr("READER_ADDR", ":8080")
	dataDir := envOr("READER_DATA_DIR", "/data")
	staticDir := envOr("READER_STATIC_DIR", "/app/static")
	passphrase := os.Getenv("READER_PASSPHRASE")
	if passphrase == "" {
		log.Fatal("READER_PASSPHRASE is not set - refusing to start without a login")
	}

	store, err := NewStore(dataDir)
	if err != nil {
		log.Fatalf("data dir %s: %v", dataDir, err)
	}
	srv := NewServer(store, NewAuth(passphrase), staticDir)

	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           srv.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
		// Generous enough for a 50 MB upload over slow Wi-Fi.
		ReadTimeout:  5 * time.Minute,
		WriteTimeout: 5 * time.Minute,
		IdleTimeout:  2 * time.Minute,
	}

	// SIGTERM is how the kubelet asks us to stop. Finish in-flight requests
	// (a progress save, an upload) instead of dropping them mid-write.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shutdownCtx)
	}()

	log.Printf("book-reader listening on %s (data %s, static %s)", addr, dataDir, staticDir)
	if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
