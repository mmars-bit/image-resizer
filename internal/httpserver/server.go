package httpserver

import (
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"time"

	"image-resizer/internal/image"
	"image-resizer/web"
)

type Config struct {
	MaxUploadBytes int64
}

type Server struct {
	processor  *image.Processor
	config     Config
	logger     *slog.Logger
	processing chan struct{}
	handler    http.Handler
}

func New(processor *image.Processor, config Config, logger *slog.Logger) (*Server, error) {
	if config.MaxUploadBytes <= 0 {
		return nil, fmt.Errorf("max upload size must be positive")
	}
	assets, err := fs.Sub(web.Files, ".")
	if err != nil {
		return nil, fmt.Errorf("load embedded assets: %w", err)
	}
	server := &Server{
		processor: processor, config: config, logger: logger,
		// libvips is memory efficient, but one active conversion is a predictable
		// memory bound for this intentionally small single-container service.
		processing: make(chan struct{}, 1),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", server.health)
	mux.HandleFunc("POST /api/resize", server.resize)
	mux.Handle("GET /", http.FileServer(http.FS(assets)))
	serverHandler := securityHeaders(mux)
	server.handler = serverHandler
	return server, nil
}

// Handler returns the HTTP application handler for use by main and tests.
func (s *Server) Handler() http.Handler { return s.handler }

func (s *Server) HTTPServer(address string) *http.Server {
	return &http.Server{
		Addr:              address,
		Handler:           s.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      2 * time.Minute,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    8 << 10,
	}
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}
