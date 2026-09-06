# Image Resizer

Kleines, eigenständiges Web-Tool zum Hochladen, Skalieren, Zuschneiden und Konvertieren von Bildern. Go liefert die eingebettete HTML-, CSS- und JavaScript-Oberfläche direkt aus; `libvips` verarbeitet Bilder effizient im Speicher. Es gibt keine Datenbank, Anmeldung oder persistente Uploads.

## Features

- Drag and Drop, Dateiauswahl und Einfügen aus der Zwischenablage
- Frei wählbare Zielgrößen sowie gängige Presets
- Seitenverhältnis-Sperre und Presets für gängige Zielgrößen
- Seitenverhältnisgebundene Crop-Auswahl für Crop / Cover sowie freie Ausschnittauswahl für Stretch
- Crop skaliert den ausgewählten Ausschnitt ohne Verzerrung auf die Zielgröße
- Resize-Modi: Stretch, Crop / Cover und Fit / Contain mit Hintergrundfarbe
- Ausgabe als JPEG, PNG, WebP und AVIF (wenn der Container-Codec AVIF unterstützt)
- Lokale Originalvorschau sowie serverseitige Ergebnisvorschau und Download
- Live-Vorschau: das Ergebnis wird nach einer kurzen Pause automatisch neu erzeugt, sobald Crop oder Einstellungen fertig geändert sind (abschaltbar)
- Einstellbare Qualität für JPEG, WebP und AVIF
- Metadatenentfernung inklusive EXIF/GPS ist standardmäßig aktiv
- Validierung, Upload- und Pixelgrenzen sowie saubere Fehlermeldungen

Die Weboberfläche startet mit Stretch und JPEG als Ausgabeformat. Bei einem gewählten Zielseitenverhältnis wird die Höhe aus der Breite berechnet.

## Architektur

- `cmd/server`: Go-Startpunkt und Konfiguration aus Umgebungsvariablen
- `internal/image`: Bildlogik und Validierung mit `govips` / `libvips`
- `internal/httpserver`: HTTP-Endpunkte und Multipart-Upload
- `web`: eingebettete statische Vanilla-JavaScript-Oberfläche

Dateien werden als begrenzter Multipart-Request eingelesen und ausschließlich im Arbeitsspeicher verarbeitet. Falls der Multipart-Parser temporäre Dateien anlegt, werden diese vor Ende des Requests mit `RemoveAll` entfernt. Der Server verarbeitet bewusst nur eine Konvertierung gleichzeitig, um den RAM-Bedarf im Einzelcontainer vorhersehbar zu halten.

## Voraussetzungen

Für den Normalbetrieb ist nur Docker mit aktivem Linux-Container-Daemon erforderlich. Es ist kein Node.js- oder Host-Build-Schritt notwendig.

## Docker

```bash
docker build -t image-resizer .
docker run --rm -p 8080:8080 image-resizer
```

Danach ist die Anwendung unter <http://localhost:8080> erreichbar.

## Docker Compose

```bash
docker compose up -d --build
```

Die Anwendung ist anschließend unter <http://localhost:8080> erreichbar. Beenden mit:

```bash
docker compose down
```

## Konfiguration

| Variable | Standard | Bedeutung |
| --- | ---: | --- |
| `PORT` | `8080` | HTTP-Port |
| `MAX_UPLOAD_MB` | `50` | Maximale Uploadgröße in MB |
| `MAX_WIDTH` | `16384` | Maximale Zielbreite in Pixel |
| `MAX_HEIGHT` | `16384` | Maximale Zielhöhe in Pixel |
| `MAX_MEGAPIXELS` | `100` | Maximale Pixelanzahl des Eingabebildes |

Ungültige oder nicht-positive Limitwerte verhindern den Serverstart. Nicht numerische Umgebungswerte verwenden den jeweiligen Standardwert.

## Unterstützte Bildformate

Der Container installiert `libvips` und HEIF-Codec-Plugins. Damit stehen in der Standardkonfiguration JPEG, PNG, WebP, TIFF, GIF, HEIC/HEIF und AVIF zur Verfügung, soweit der jeweilige `libvips`-Decoder das konkrete Bild unterstützt. Nicht unterstützte oder beschädigte Dateien liefern eine kontrollierte Fehlermeldung.

Als Ausgabe werden JPEG, PNG, WebP und AVIF angeboten. Die AVIF-Verfügbarkeit setzt voraus, dass der verwendete `libvips`-/HEIF-Build einen AV1-Encoder bereitstellt; das Docker-Image installiert die Debian-HEIF-Plugins dafür.

## API

`POST /api/resize` akzeptiert `multipart/form-data` mit den Feldern `file`, `width`, `height`, `mode`, `format`, `quality`, `cropX`, `cropY`, `background` und `stripMetadata`. Die Weboberfläche sendet bei Crop zusätzlich `cropLeft`, `cropTop`, `cropWidth` und `cropHeight` als normalisierte Werte zwischen `0` und `1`. Mit `mode=crop` wird der Ausschnitt ohne Verzerrung auf `width` x `height` skaliert; mit `mode=stretch` wird das Bild, oder ein optionaler manueller Ausschnitt, auf diese Größe gedehnt.

```bash
curl \
  -F "file=@image.jpg" \
  -F "width=1920" \
  -F "height=1080" \
  -F "mode=crop" \
  -F "format=webp" \
  -F "quality=85" \
  -F "cropX=center" \
  -F "cropY=center" \
  -F "stripMetadata=true" \
  http://localhost:8080/api/resize \
  --output result.webp
```

Bei Erfolg liefert der Endpoint die Bilddaten mit passendem `Content-Type` und einem Download-Dateinamen. `GET /health` antwortet mit `{"status":"ok"}`.

## Limits und Sicherheit

- Die Request-Größe wird auf Uploadlimit plus Multipart-Overhead begrenzt.
- Nach dem Laden prüft der Dienst die Eingabepixelzahl vor der eigentlichen Transformation, um Decompression-Bombs abzuweisen.
- Zielbreite und Zielhöhe werden serverseitig geprüft.
- HTTP-Lese-, Schreib- und Idle-Timeouts sind gesetzt.
- Fehlerantworten enthalten keine internen libvips-Details; Details werden nur im Serverlog erfasst.

## Tests

Die Bildtests laufen im Build-Container oder auf einem System mit `libvips-dev`:

```bash
go test ./...
```

Sie prüfen die exakten Ergebnisdimensionen aller drei Resize-Modi und ungültige Dimensionen, Modi und Qualitätswerte.

## Releases

Pushes auf `main` aktualisieren automatisch einen Release-PR anhand von Conventional Commits. `fix:` erhöht die Patch-Version, `feat:` die Minor-Version und ein Breaking Change die Major-Version. Beim Merge des Release-PRs wird ein GitHub Release erstellt und das Docker-Image mit der vollständigen Version, Major/Minor-Version, Major-Version und `latest` zu Docker Hub gepusht.

Das Repository benötigt die Actions-Variable `DOCKERHUB_USERNAME` und das Actions-Secret `DOCKERHUB_TOKEN`. Der Token sollte ein Docker-Hub-Zugriffstoken mit Schreibzugriff auf das Repository `image-resizer` sein.

Die aktuelle Anwendungs-Version steht in `internal/appversion/version.txt`, wird direkt in das Go-Binary eingebettet und in der Weboberfläche angezeigt. Release Please aktualisiert diese Datei im Release-PR; Docker-Buildnummern oder lokale Build-Argumente verändern die angezeigte Version nicht. Release-Images werden für `linux/amd64` und `linux/arm64` veröffentlicht.
