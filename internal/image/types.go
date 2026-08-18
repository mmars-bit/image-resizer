package image

import "errors"

const (
	ModeStretch = "stretch"
	ModeCrop    = "crop"
	ModeFit     = "fit"
)

const (
	FormatJPEG = "jpeg"
	FormatPNG  = "png"
	FormatWebP = "webp"
	FormatAVIF = "avif"
)

var (
	ErrInvalidDimensions = errors.New("invalid target dimensions")
	ErrInvalidMode       = errors.New("invalid resize mode")
	ErrInvalidFormat     = errors.New("invalid output format")
	ErrInvalidQuality    = errors.New("invalid quality")
	ErrInvalidCrop       = errors.New("invalid crop position")
	ErrInvalidBackground = errors.New("invalid background color")
	ErrTooManyPixels     = errors.New("image exceeds pixel limit")
	ErrUnsupportedImage  = errors.New("unsupported image")
)

// Limits bounds decoding and output dimensions for untrusted uploads.
type Limits struct {
	MaxWidth      int
	MaxHeight     int
	MaxMegapixels int
}

type Request struct {
	Width         int
	Height        int
	Mode          string
	Format        string
	Quality       int
	CropX         string
	CropY         string
	Background    string
	StripMetadata bool
}

type Result struct {
	Data        []byte
	ContentType string
	Extension   string
	Width       int
	Height      int
	InputWidth  int
	InputHeight int
}
