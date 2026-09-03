package httpserver

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"image-resizer/internal/image"
)

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
