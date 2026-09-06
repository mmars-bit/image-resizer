package web

import "embed"

// Files contains the static single-page application served by the Go binary.
//
//go:embed index.html app.js style.css favicon.png
var Files embed.FS
