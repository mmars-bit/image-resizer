package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/davidbyttow/govips/v2/vips"

	"image-resizer/internal/httpserver"
	"image-resizer/internal/image"
)

// version is replaced at build time for release images.
var version = "dev"

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if err := vips.Startup(nil); err != nil {
		logger.Error("could not start libvips", "error", err)
		os.Exit(1)
	}
	defer vips.Shutdown()

	maxUploadMB := envInt("MAX_UPLOAD_MB", 50)
	limits := image.Limits{
		MaxWidth: envInt("MAX_WIDTH", 16_384), MaxHeight: envInt("MAX_HEIGHT", 16_384), MaxMegapixels: envInt("MAX_MEGAPIXELS", 100),
	}
	if maxUploadMB <= 0 || limits.MaxWidth <= 0 || limits.MaxHeight <= 0 || limits.MaxMegapixels <= 0 {
		logger.Error("environment limits must be positive")
		os.Exit(1)
	}
	app, err := httpserver.New(image.NewProcessor(limits), httpserver.Config{MaxUploadBytes: int64(maxUploadMB) << 20, Version: version}, logger)
	if err != nil {
		logger.Error("could not initialize server", "error", err)
		os.Exit(1)
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	server := app.HTTPServer(":" + port)
	go func() {
		logger.Info("server listening", "version", version, "port", port, "max_upload_mb", maxUploadMB, "max_megapixels", limits.MaxMegapixels)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server stopped unexpectedly", "error", err)
			os.Exit(1)
		}
	}()

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	<-signals
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdown); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
}

func envInt(name string, fallback int) int {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}
