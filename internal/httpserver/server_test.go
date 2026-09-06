package httpserver

import (
	"bytes"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"image-resizer/internal/image"
)

var pngSignature = []byte("\x89PNG\r\n\x1a\n")

func TestVersion(t *testing.T) {
	server, err := New(
		image.NewProcessor(image.Limits{}),
		Config{MaxUploadBytes: 1, Version: "1.2.3"},
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/version", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want %q", got, "no-store")
	}
	if got := response.Body.String(); got != "{\"version\":\"1.2.3\"}\n" {
		t.Errorf("body = %q", got)
	}
}

func TestFavicon(t *testing.T) {
	server, err := New(
		image.NewProcessor(image.Limits{}),
		Config{MaxUploadBytes: 1, Version: "test"},
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/favicon.png", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Content-Type"); got != "image/png" {
		t.Errorf("Content-Type = %q, want %q", got, "image/png")
	}
	if body := response.Body.Bytes(); len(body) < len(pngSignature) || !bytes.Equal(body[:len(pngSignature)], pngSignature) {
		t.Error("favicon response is not a PNG")
	}
}
