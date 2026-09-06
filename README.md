# Image Resizer

Kleines, eigenstaendiges Web-Tool zum Hochladen, Skalieren, Zuschneiden und Konvertieren von Bildern. Go liefert die eingebettete HTML-, CSS- und JavaScript-Oberflaeche direkt aus; `libvips` verarbeitet Bilder effizient im Speicher. Es gibt keine Datenbank, Anmeldung oder persistente Uploads.

## Features

- Drag and Drop, Dateiauswahl und Einfuegen aus der Zwischenablage
- Frei waehlbare Zielgroessen sowie gaengige Presets
- Seitenverhaeltnis-Sperre und Presets fuer gaengige Zielgroessen
- Seitenverhaeltnisgebundene Crop-Auswahl fuer Crop / Cover sowie freie Ausschnittauswahl fuer Stretch
- Crop skaliert den ausgewaehlten Ausschnitt ohne Verzerrung auf die Zielgroesse
- Resize-Modi: Stretch, Crop / Cover und Fit / Contain mit Hintergrundfarbe
- Ausgabe als JPEG, PNG, WebP und AVIF (wenn der Container-Codec AVIF unterstuetzt)
- Lokale Originalvorschau sowie serverseitige Ergebnisvorschau und Download
- Zoom bis 800 % in beiden Vorschauen: Strg + Mausrad oder die Schaltflächen unter der Vorschau, Verschieben mit Alt + Ziehen oder der mittleren Maustaste. Der Crop-Rahmen folgt dem Zoom, das Ergebnis bleibt davon unberührt
- Live-Vorschau: das Ergebnis wird nach einer kurzen Pause automatisch neu erzeugt, sobald Crop oder Einstellungen fertig geaendert sind (abschaltbar)
- Einstellbare Qualitaet fuer JPEG, WebP und AVIF
- Metadatenentfernung inklusive EXIF/GPS ist standardmaessig aktiv
- Validierung, Upload- und Pixelgrenzen sowie saubere Fehlermeldungen

Die Weboberflaeche startet mit Stretch und JPEG als Ausgabeformat. Bei einem gewaehlten Zielseitenverhaeltnis wird die Hoehe aus der Breite berechnet.

## Architektur

- `cmd/server`: Go-Startpunkt und Konfiguration aus Umgebungsvariablen
- `internal/image`: Bildlogik und Validierung mit `govips` / `libvips`
- `internal/httpserver`: HTTP-Endpunkte und Multipart-Upload
- `web`: eingebettete statische Vanilla-JavaScript-Oberflaeche

Dateien werden als begrenzter Multipart-Request eingelesen und ausschliesslich im Arbeitsspeicher verarbeitet. Falls der Multipart-Parser temporaere Dateien anlegt, werden diese vor Ende des Requests mit `RemoveAll` entfernt. Der Server verarbeitet bewusst nur eine Konvertierung gleichzeitig, um den RAM-Bedarf im Einzelcontainer vorhersehbar zu halten.

## Voraussetzungen

Fuer den Normalbetrieb ist nur Docker mit aktivem Linux-Container-Daemon erforderlich. Es ist kein Node.js- oder Host-Build-Schritt notwendig.

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

Die Anwendung ist anschliessend unter <http://localhost:8080> erreichbar. Beenden mit:

```bash
docker compose down
```

## Konfiguration

| Variable | Standard | Bedeutung |
| --- | ---: | --- |
| `PORT` | `8080` | HTTP-Port |
| `MAX_UPLOAD_MB` | `50` | Maximale Uploadgroesse in MB |
| `MAX_WIDTH` | `16384` | Maximale Zielbreite in Pixel |
| `MAX_HEIGHT` | `16384` | Maximale Zielhoehe in Pixel |
| `MAX_MEGAPIXELS` | `100` | Maximale Pixelanzahl des Eingabebildes |

Ungueltige oder nicht-positive Limitwerte verhindern den Serverstart. Nicht numerische Umgebungswerte verwenden den jeweiligen Standardwert.

## Unterstuetzte Bildformate

Der Container installiert `libvips` und HEIF-Codec-Plugins. Damit stehen in der Standardkonfiguration JPEG, PNG, WebP, TIFF, GIF, HEIC/HEIF und AVIF zur Verfuegung, soweit der jeweilige `libvips`-Decoder das konkrete Bild unterstuetzt. Nicht unterstuetzte oder beschaedigte Dateien liefern eine kontrollierte Fehlermeldung.

Als Ausgabe werden JPEG, PNG, WebP und AVIF angeboten. Die AVIF-Verfuegbarkeit setzt voraus, dass der verwendete `libvips`-/HEIF-Build einen AV1-Encoder bereitstellt; das Docker-Image installiert die Debian-HEIF-Plugins dafuer.

## API

`POST /api/resize` akzeptiert `multipart/form-data` mit den Feldern `file`, `width`, `height`, `mode`, `format`, `quality`, `cropX`, `cropY`, `background` und `stripMetadata`. Die Weboberflaeche sendet bei Crop zusaetzlich `cropLeft`, `cropTop`, `cropWidth` und `cropHeight` als normalisierte Werte zwischen `0` und `1`. Mit `mode=crop` wird der Ausschnitt ohne Verzerrung auf `width` x `height` skaliert; mit `mode=stretch` wird das Bild, oder ein optionaler manueller Ausschnitt, auf diese Groesse gedehnt.

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

- Die Request-Groesse wird auf Uploadlimit plus Multipart-Overhead begrenzt.
- Nach dem Laden prueft der Dienst die Eingabepixelzahl vor der eigentlichen Transformation, um Decompression-Bombs abzuweisen.
- Zielbreite und Zielhoehe werden serverseitig geprueft.
- HTTP-Lese-, Schreib- und Idle-Timeouts sind gesetzt.
- Fehlerantworten enthalten keine internen libvips-Details; Details werden nur im Serverlog erfasst.

## Tests

Die Bildtests laufen im Build-Container oder auf einem System mit `libvips-dev`:

```bash
go test ./...
```

Sie pruefen die exakten Ergebnisdimensionen aller drei Resize-Modi und ungueltige Dimensionen, Modi und Qualitaetswerte.

## Releases

Pushes auf `main` aktualisieren automatisch einen Release-PR anhand von Conventional Commits. `fix:` erhoeht die Patch-Version, `feat:` die Minor-Version und ein Breaking Change die Major-Version. Beim Merge des Release-PRs wird ein GitHub Release erstellt und das Docker-Image mit der vollstaendigen Version, Major/Minor-Version, Major-Version und `latest` zu Docker Hub gepusht.

Das Repository benoetigt die Actions-Variable `DOCKERHUB_USERNAME` und das Actions-Secret `DOCKERHUB_TOKEN`. Der Token sollte ein Docker-Hub-Zugriffstoken mit Schreibzugriff auf das Repository `image-resizer` sein.

Die aktuelle Anwendungs-Version steht in `internal/appversion/version.txt`, wird direkt in das Go-Binary eingebettet und in der Weboberflaeche angezeigt. Release Please aktualisiert diese Datei im Release-PR; Docker-Buildnummern oder lokale Build-Argumente veraendern die angezeigte Version nicht. Release-Images werden fuer `linux/amd64` und `linux/arm64` veroeffentlicht.
