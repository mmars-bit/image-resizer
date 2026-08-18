package image

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"testing"

	"github.com/davidbyttow/govips/v2/vips"
)

var testProcessor = NewProcessor(Limits{MaxWidth: 16_384, MaxHeight: 16_384, MaxMegapixels: 100})

func TestMain(m *testing.M) {
	if err := vips.Startup(nil); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	code := m.Run()
	vips.Shutdown()
	os.Exit(code)
}

func TestStretchProducesExactDimensions(t *testing.T) {
	result := processFixture(t, 400, 300, Request{Width: 1920, Height: 1080, Mode: ModeStretch, Format: FormatPNG, Quality: 85, StripMetadata: true})
	assertDimensions(t, result.Data, 1920, 1080)
}

func TestCropProducesExactDimensionsAndPreservesAspectBeforeCrop(t *testing.T) {
	left := processFixture(t, 400, 300, Request{Width: 100, Height: 300, Mode: ModeCrop, Format: FormatPNG, Quality: 85, CropX: "left", CropY: "center", StripMetadata: true})
	right := processFixture(t, 400, 300, Request{Width: 100, Height: 300, Mode: ModeCrop, Format: FormatPNG, Quality: 85, CropX: "right", CropY: "center", StripMetadata: true})
	assertDimensions(t, left.Data, 100, 300)
	assertDimensions(t, right.Data, 100, 300)

	leftImage := decodePNG(t, left.Data)
	rightImage := decodePNG(t, right.Data)
	leftRed, _, _, _ := leftImage.At(0, 150).RGBA()
	rightRed, _, _, _ := rightImage.At(0, 150).RGBA()
	// Cover must crop the original 4:3 raster, not stretch it to 1:3.
	if leftRed > 2<<8 || rightRed < 40<<8 {
		t.Fatalf("crop positions indicate a stretched source: left=%d right=%d", leftRed>>8, rightRed>>8)
	}
}

func TestFitProducesExactDimensionsAndPreservesAspect(t *testing.T) {
	result := processFixture(t, 400, 300, Request{Width: 1920, Height: 1080, Mode: ModeFit, Format: FormatPNG, Quality: 85, Background: "black", StripMetadata: true})
	assertDimensions(t, result.Data, 1920, 1080)

	// The 4:3 image is contained at 1440x1080, leaving 240px bars on each side.
	img := decodePNG(t, result.Data)
	if img.Bounds().Dx() != 1920 || img.Bounds().Dy() != 1080 {
		t.Fatalf("got %dx%d", img.Bounds().Dx(), img.Bounds().Dy())
	}
	_, outerGreen, outerBlue, _ := img.At(0, 540).RGBA()
	_, innerGreen, innerBlue, _ := img.At(240, 540).RGBA()
	if outerGreen != 0 || outerBlue != 0 || innerBlue == 0 || innerGreen == 0 {
		t.Fatal("fit did not retain the source proportions inside centered black bars")
	}
}

func TestInvalidRequestsAreRejected(t *testing.T) {
	base := Request{Width: 100, Height: 100, Mode: ModeStretch, Format: FormatPNG, Quality: 85}
	for name, mutate := range map[string]func(*Request){
		"dimensions": func(r *Request) { r.Width = 0 },
		"mode":       func(r *Request) { r.Mode = "unknown" },
		"quality":    func(r *Request) { r.Quality = 101 },
	} {
		t.Run(name, func(t *testing.T) {
			req := base
			mutate(&req)
			if err := testProcessor.validate(req); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func processFixture(t *testing.T, width, height int, req Request) Result {
	t.Helper()
	fixture := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			fixture.SetNRGBA(x, y, color.NRGBA{R: uint8(x), G: uint8(y), B: 120, A: 255})
		}
	}
	img, err := vips.NewImageFromGoImage(fixture)
	if err != nil {
		t.Fatal(err)
	}
	data, _, err := img.ExportPng(vips.NewPngExportParams())
	img.Close()
	if err != nil {
		t.Fatal(err)
	}
	result, err := testProcessor.Process(data, req)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func assertDimensions(t *testing.T, data []byte, width, height int) {
	t.Helper()
	img, err := vips.NewImageFromBuffer(data)
	if err != nil {
		t.Fatal(err)
	}
	defer img.Close()
	if img.Width() != width || img.Height() != height {
		t.Fatalf("got %dx%d, want %dx%d", img.Width(), img.Height(), width, height)
	}
}

func decodePNG(t *testing.T, data []byte) image.Image {
	t.Helper()
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	return img
}
