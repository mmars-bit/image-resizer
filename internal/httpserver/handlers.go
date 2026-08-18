package httpserver

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"

	"image-resizer/internal/image"
)

func (s *Server) resize(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	// The extra space admits multipart boundaries and the small form fields.
	r.Body = http.MaxBytesReader(w, r.Body, s.config.MaxUploadBytes+(1<<20))
	if err := r.ParseMultipartForm(s.config.MaxUploadBytes + (1 << 20)); err != nil {
		s.handleMultipartError(w, err)
		return
	}
	defer r.MultipartForm.RemoveAll()

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "Bitte waehlen Sie eine Bilddatei aus.")
		return
	}
	defer file.Close()
	if header.Size <= 0 {
		writeError(w, http.StatusBadRequest, "Die hochgeladene Datei ist leer.")
		return
	}
	if header.Size > s.config.MaxUploadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "Die Datei ist zu gross.")
		return
	}
	data, err := io.ReadAll(io.LimitReader(file, s.config.MaxUploadBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Die Datei konnte nicht gelesen werden.")
		return
	}
	if int64(len(data)) > s.config.MaxUploadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "Die Datei ist zu gross.")
		return
	}
	req, err := parseRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, requestErrorMessage(err))
		return
	}
	s.logger.Info("resize request", "bytes", len(data), "width", req.Width, "height", req.Height, "mode", req.Mode, "format", req.Format)

	select {
	case s.processing <- struct{}{}:
		defer func() { <-s.processing }()
	case <-r.Context().Done():
		return
	}
	result, err := s.processor.Process(data, req)
	if err != nil {
		status, message := processError(err)
		s.logger.Error("image processing failed", "error", err, "duration", time.Since(started))
		writeError(w, status, message)
		return
	}

	filename := outputFilename(header.Filename, result.Width, result.Height, result.Extension)
	w.Header().Set("Content-Type", result.ContentType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	w.Header().Set("Content-Length", strconv.Itoa(len(result.Data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(result.Data)
	s.logger.Info("image resized", "duration", time.Since(started), "input_width", result.InputWidth, "input_height", result.InputHeight, "output_width", result.Width, "output_height", result.Height, "format", req.Format)
}

func (s *Server) handleMultipartError(w http.ResponseWriter, err error) {
	var maxErr *http.MaxBytesError
	if errors.As(err, &maxErr) {
		writeError(w, http.StatusRequestEntityTooLarge, "Die Datei ist zu gross.")
		return
	}
	writeError(w, http.StatusBadRequest, "Ungueltiger Upload. Bitte waehlen Sie eine Bilddatei aus.")
}

func parseRequest(r *http.Request) (image.Request, error) {
	width, err := parseIntField(r, "width")
	if err != nil {
		return image.Request{}, err
	}
	height, err := parseIntField(r, "height")
	if err != nil {
		return image.Request{}, err
	}
	quality, err := parseIntField(r, "quality")
	if err != nil {
		return image.Request{}, err
	}
	stripMetadata := true
	if value := r.FormValue("stripMetadata"); value != "" {
		stripMetadata, err = strconv.ParseBool(value)
		if err != nil {
			return image.Request{}, fmt.Errorf("invalid stripMetadata")
		}
	}
	return image.Request{
		Width: width, Height: height, Mode: r.FormValue("mode"), Format: r.FormValue("format"), Quality: quality,
		CropX:         defaultValue(r.FormValue("cropX"), "center"),
		CropY:         defaultValue(r.FormValue("cropY"), "center"),
		Background:    defaultValue(r.FormValue("background"), "black"),
		StripMetadata: stripMetadata,
	}, nil
}

func parseIntField(r *http.Request, name string) (int, error) {
	value := r.FormValue(name)
	if value == "" {
		return 0, fmt.Errorf("missing %s", name)
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("invalid %s", name)
	}
	return parsed, nil
}

func defaultValue(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func requestErrorMessage(error) string {
	return "Bitte geben Sie gueltige Werte fuer Breite, Hoehe und Qualitaet an."
}

func processError(err error) (int, string) {
	switch {
	case errors.Is(err, image.ErrInvalidDimensions):
		return http.StatusBadRequest, "Die Zielaufloesung ist ungueltig oder zu gross."
	case errors.Is(err, image.ErrInvalidMode), errors.Is(err, image.ErrInvalidFormat), errors.Is(err, image.ErrInvalidQuality), errors.Is(err, image.ErrInvalidCrop), errors.Is(err, image.ErrInvalidBackground):
		return http.StatusBadRequest, "Die gewaehlten Verarbeitungseinstellungen sind ungueltig."
	case errors.Is(err, image.ErrTooManyPixels):
		return http.StatusRequestEntityTooLarge, "Das Bild hat zu viele Pixel."
	case errors.Is(err, image.ErrUnsupportedImage):
		return http.StatusUnprocessableEntity, "Dieses Bildformat wird nicht unterstuetzt oder die Datei ist beschaedigt."
	default:
		return http.StatusInternalServerError, "Das Bild konnte nicht verarbeitet werden."
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func outputFilename(original string, width, height int, extension string) string {
	base := strings.TrimSuffix(filepath.Base(original), filepath.Ext(original))
	base = safeLogName(base)
	if base == "" {
		base = "image"
	}
	return fmt.Sprintf("%s-%dx%d.%s", base, width, height, extension)
}

func safeLogName(value string) string {
	var b strings.Builder
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_' || r == '.' {
			b.WriteRune(r)
		}
	}
	return strings.Trim(b.String(), ".")
}
