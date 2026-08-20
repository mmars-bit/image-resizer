package image

import (
	"fmt"
	"math"
	"strings"

	"github.com/davidbyttow/govips/v2/vips"
)

type Processor struct {
	limits Limits
}

func NewProcessor(limits Limits) *Processor {
	return &Processor{limits: limits}
}

func (p *Processor) Process(input []byte, req Request) (Result, error) {
	if err := p.validate(req); err != nil {
		return Result{}, err
	}

	img, err := vips.NewImageFromBuffer(input)
	if err != nil {
		return Result{}, fmt.Errorf("%w: %v", ErrUnsupportedImage, err)
	}
	defer img.Close()

	if err := img.AutoRotate(); err != nil {
		return Result{}, fmt.Errorf("autorotate image: %w", err)
	}
	inputWidth, inputHeight := img.Width(), img.Height()
	if inputWidth <= 0 || inputHeight <= 0 {
		return Result{}, ErrUnsupportedImage
	}
	if int64(inputWidth)*int64(inputHeight) > int64(p.limits.MaxMegapixels)*1_000_000 {
		return Result{}, ErrTooManyPixels
	}

	switch req.Mode {
	case ModeStretch:
		if req.ManualCrop {
			err = manualCropAndResize(img, req)
		} else {
			err = img.ResizeWithVScale(float64(req.Width)/float64(inputWidth), float64(req.Height)/float64(inputHeight), vips.KernelLanczos3)
		}
	case ModeCrop:
		err = crop(img, req)
	case ModeFit:
		err = fit(img, req)
	}
	if err != nil {
		return Result{}, fmt.Errorf("transform image: %w", err)
	}
	if img.Width() != req.Width || img.Height() != req.Height {
		return Result{}, fmt.Errorf("transform image: unexpected output size %dx%d", img.Width(), img.Height())
	}

	if req.StripMetadata {
		if err := img.RemoveMetadata(); err != nil {
			return Result{}, fmt.Errorf("remove metadata: %w", err)
		}
	}
	data, contentType, extension, err := export(img, req)
	if err != nil {
		return Result{}, fmt.Errorf("export image: %w", err)
	}
	return Result{
		Data: data, ContentType: contentType, Extension: extension,
		Width: img.Width(), Height: img.Height(), InputWidth: inputWidth, InputHeight: inputHeight,
	}, nil
}

func (p *Processor) validate(req Request) error {
	if req.Width <= 0 || req.Height <= 0 || req.Width > p.limits.MaxWidth || req.Height > p.limits.MaxHeight {
		return ErrInvalidDimensions
	}
	if req.Mode != ModeStretch && req.Mode != ModeCrop && req.Mode != ModeFit {
		return ErrInvalidMode
	}
	if req.Format != FormatJPEG && req.Format != FormatPNG && req.Format != FormatWebP && req.Format != FormatAVIF {
		return ErrInvalidFormat
	}
	if req.Quality < 1 || req.Quality > 100 {
		return ErrInvalidQuality
	}
	if req.Mode == ModeCrop && !validCrop(req.CropX, true) {
		return ErrInvalidCrop
	}
	if req.Mode == ModeCrop && !validCrop(req.CropY, false) {
		return ErrInvalidCrop
	}
	if req.ManualCrop && !validManualCrop(req) {
		return ErrInvalidManualCrop
	}
	if req.Mode == ModeFit {
		if _, _, _, _, err := parseBackground(req.Background); err != nil {
			return err
		}
		if req.Background == "transparent" && req.Format == FormatJPEG {
			return ErrInvalidBackground
		}
	}
	return nil
}

func validManualCrop(req Request) bool {
	values := []float64{req.CropLeft, req.CropTop, req.CropWidth, req.CropHeight}
	for _, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return (req.Mode == ModeCrop || req.Mode == ModeStretch) && req.CropLeft >= 0 && req.CropTop >= 0 && req.CropLeft < 1 && req.CropTop < 1 && req.CropWidth > 0 && req.CropHeight > 0 && req.CropWidth <= 1 && req.CropHeight <= 1 && req.CropLeft+req.CropWidth <= 1 && req.CropTop+req.CropHeight <= 1
}

func crop(img *vips.ImageRef, req Request) error {
	if req.ManualCrop {
		left, top, width, height := manualCropArea(img, req)
		if err := img.ExtractArea(left, top, width, height); err != nil {
			return err
		}
	}
	return resizeAndCrop(img, req)
}

func resizeAndCrop(img *vips.ImageRef, req Request) error {
	scale := math.Max(float64(req.Width)/float64(img.Width()), float64(req.Height)/float64(img.Height()))
	if err := img.Resize(scale, vips.KernelLanczos3); err != nil {
		return err
	}
	left := positionedOffset(img.Width()-req.Width, req.CropX)
	top := positionedOffset(img.Height()-req.Height, req.CropY)
	return img.ExtractArea(left, top, req.Width, req.Height)
}

func manualCropAndResize(img *vips.ImageRef, req Request) error {
	left, top, width, height := manualCropArea(img, req)
	if err := img.ExtractArea(left, top, width, height); err != nil {
		return err
	}
	return img.ResizeWithVScale(float64(req.Width)/float64(width), float64(req.Height)/float64(height), vips.KernelLanczos3)
}

func manualCropArea(img *vips.ImageRef, req Request) (int, int, int, int) {
	left := int(math.Floor(req.CropLeft * float64(img.Width())))
	top := int(math.Floor(req.CropTop * float64(img.Height())))
	right := min(img.Width(), max(left+1, int(math.Ceil((req.CropLeft+req.CropWidth)*float64(img.Width())))))
	bottom := min(img.Height(), max(top+1, int(math.Ceil((req.CropTop+req.CropHeight)*float64(img.Height())))))
	return left, top, right - left, bottom - top
}

func fit(img *vips.ImageRef, req Request) error {
	scale := math.Min(float64(req.Width)/float64(img.Width()), float64(req.Height)/float64(img.Height()))
	if err := img.Resize(scale, vips.KernelLanczos3); err != nil {
		return err
	}
	r, g, b, a, err := parseBackground(req.Background)
	if err != nil {
		return err
	}
	if a == 0 && !img.HasAlpha() {
		if err := img.AddAlpha(); err != nil {
			return err
		}
	}
	return img.EmbedBackgroundRGBA((req.Width-img.Width())/2, (req.Height-img.Height())/2, req.Width, req.Height, &vips.ColorRGBA{R: r, G: g, B: b, A: a})
}

func positionedOffset(remaining int, position string) int {
	if remaining <= 0 {
		return 0
	}
	switch position {
	case "right", "bottom":
		return remaining
	case "center":
		return remaining / 2
	default:
		return 0
	}
}

func validCrop(value string, horizontal bool) bool {
	if horizontal {
		return value == "left" || value == "center" || value == "right"
	}
	return value == "top" || value == "center" || value == "bottom"
}

func parseBackground(value string) (uint8, uint8, uint8, uint8, error) {
	switch value {
	case "black":
		return 0, 0, 0, 255, nil
	case "white":
		return 255, 255, 255, 255, nil
	case "transparent":
		return 0, 0, 0, 0, nil
	}
	if len(value) != 7 || !strings.HasPrefix(value, "#") {
		return 0, 0, 0, 0, ErrInvalidBackground
	}
	var r, g, b uint8
	if _, err := fmt.Sscanf(value, "#%02x%02x%02x", &r, &g, &b); err != nil {
		return 0, 0, 0, 0, ErrInvalidBackground
	}
	return r, g, b, 255, nil
}

func export(img *vips.ImageRef, req Request) ([]byte, string, string, error) {
	switch req.Format {
	case FormatJPEG:
		if img.HasAlpha() {
			r, g, b := uint8(0), uint8(0), uint8(0)
			if req.Mode == ModeFit {
				r, g, b, _, _ = parseBackground(req.Background)
			}
			if err := img.Flatten(&vips.Color{R: r, G: g, B: b}); err != nil {
				return nil, "", "", err
			}
		}
		data, _, err := img.ExportJpeg(&vips.JpegExportParams{Quality: req.Quality, StripMetadata: req.StripMetadata, OptimizeCoding: true})
		return data, "image/jpeg", "jpg", err
	case FormatPNG:
		data, _, err := img.ExportPng(&vips.PngExportParams{Compression: 6, StripMetadata: req.StripMetadata})
		return data, "image/png", "png", err
	case FormatWebP:
		data, _, err := img.ExportWebp(&vips.WebpExportParams{Quality: req.Quality, StripMetadata: req.StripMetadata, ReductionEffort: 4})
		return data, "image/webp", "webp", err
	case FormatAVIF:
		data, _, err := img.ExportAvif(&vips.AvifExportParams{Quality: req.Quality, StripMetadata: req.StripMetadata, Effort: 4})
		return data, "image/avif", "avif", err
	default:
		return nil, "", "", ErrInvalidFormat
	}
}
