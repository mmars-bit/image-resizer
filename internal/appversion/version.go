package appversion

import (
	_ "embed"
	"strings"
)

//go:embed version.txt
var embedded string

// Current returns the source-controlled application version.
func Current() string {
	return strings.TrimSpace(embedded)
}
