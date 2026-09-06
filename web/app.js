const form = document.querySelector('#resize-form');
const fileInput = document.querySelector('#file');
const dropZone = document.querySelector('#drop-zone');
const chooseFile = document.querySelector('#choose-file');
const newImage = document.querySelector('#new-image');
const submitButtons = document.querySelectorAll('[data-submit]');
const loading = document.querySelector('#loading');
const sourcePreview = document.querySelector('#source-preview');
const sourceWrap = document.querySelector('#source-preview-wrap');
const sourcePlaceholder = document.querySelector('#source-placeholder');
const sourceDetails = document.querySelector('#source-details');
const uploadError = document.querySelector('#upload-error');
const formError = document.querySelector('#form-error');
const resultPanel = document.querySelector('#result-panel');
const resultPreview = document.querySelector('#result-preview');
const download = document.querySelector('#download');
const resultStatus = document.querySelector('#result-status');
const resultState = document.querySelector('#result-state');
const livePreview = document.querySelector('#live-preview');
const cropEditor = document.querySelector('#crop-editor');
const cropSelection = document.querySelector('#crop-selection');
const resetCrop = document.querySelector('#reset-crop');
const appVersion = document.querySelector('#app-version');
const resultWrap = document.querySelector('#result-preview-wrap');
const zoomHint = document.querySelector('#zoom-hint');
let selectedFile;
let sourceURL;
let resultURL;
let cropState;
let cropDrag;
let cropHoverPoint;
let pageDragDepth = 0;
let busy = false;
let previewTimer;
let previewPending = false;
let previewController;
let renderedKey;
const settingsStorageKey = 'image-resizer.settings.v2';
// The pause that marks an edit as finished, so dragging never triggers a render.
const previewDelay = 450;

async function loadVersion() {
  try {
    const response = await fetch('/api/version', { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const data = await response.json();
    if (typeof data.version === 'string' && data.version) {
      appVersion.textContent = data.version === 'dev' ? data.version : `v${data.version}`;
    }
  } catch (_) { /* The development label remains when version lookup fails. */ }
}

loadVersion();

// --- Zoom -------------------------------------------------------------------
// Beide Vorschauen lassen sich vergrößern, um Details zu beurteilen. Der Zoom
// ist reine Ansicht: er verändert weder den Crop noch die Anfrage an den Server.
// Feste Zoomstufen, damit die Anzeige runde Werte zeigt statt krummer
// Vielfacher. Das Mausrad zoomt weiterhin stufenlos; + und - springen zur
// nächsten Stufe darüber bzw. darunter.
const zoomStops = [1, 1.25, 1.5, 2, 3, 4, 6, 8];
const minZoom = zoomStops[0];
const maxZoom = zoomStops[zoomStops.length - 1];

// Nächste Stufe ober- bzw. unterhalb des aktuellen Zooms. Die Toleranz
// verhindert, dass eine gerade erreichte Stufe sich selbst als Ziel meldet.
function nextZoomStop(scale, direction) {
  const stops = direction > 0 ? zoomStops : [...zoomStops].reverse();
  const found = stops.find((stop) => (direction > 0 ? stop > scale + 0.001 : stop < scale - 0.001));
  return found ?? (direction > 0 ? maxZoom : minZoom);
}

function createZoom(wrap, image, controls, { onChange, blocked } = {}) {
  const levelButton = controls.querySelector('[data-zoom-level]');
  const inButton = controls.querySelector('[data-zoom-in]');
  const outButton = controls.querySelector('[data-zoom-out]');
  const state = { scale: 1, x: 0, y: 0 };
  let pan;

  // Die gemalte Bildfläche bei Zoom 1, gemessen im Vorschaufeld. `object-fit:
  // contain` lässt je nach Seitenverhältnis Ränder frei, die hier abgezogen werden.
  function baseRect() {
    const boxWidth = image.clientWidth;
    const boxHeight = image.clientHeight;
    const aspect = image.naturalWidth / image.naturalHeight;
    if (!boxWidth || !boxHeight || !Number.isFinite(aspect) || aspect <= 0) return undefined;
    const width = Math.min(boxWidth, boxHeight * aspect);
    const height = width / aspect;
    return {
      left: image.offsetLeft + (boxWidth - width) / 2,
      top: image.offsetTop + (boxHeight - height) / 2,
      width,
      height,
    };
  }

  // Die Bildfläche im aktuellen Zoom. Der Crop-Rahmen richtet sich danach aus.
  function rect() {
    const base = baseRect();
    if (!base) return undefined;
    const width = base.width * state.scale;
    const height = base.height * state.scale;
    return {
      left: base.left + (base.width - width) / 2 + state.x,
      top: base.top + (base.height - height) / 2 + state.y,
      width,
      height,
    };
  }

  // Hält den Ausschnitt im Bild: verschoben wird nur, solange eine Kante außerhalb liegt.
  function clampPan() {
    const base = baseRect();
    if (!base) {
      state.x = 0;
      state.y = 0;
      return;
    }
    const limitX = Math.max(0, (base.width * state.scale - wrap.clientWidth) / 2);
    const limitY = Math.max(0, (base.height * state.scale - wrap.clientHeight) / 2);
    state.x = clamp(state.x, -limitX, limitX);
    state.y = clamp(state.y, -limitY, limitY);
  }

  function available() {
    // Nach dem Entfernen der Quelle meldet das Bild noch kurz seine alten Maße.
    return Boolean(image.naturalWidth) && Boolean(image.getAttribute('src')) && !image.hidden;
  }

  function apply() {
    clampPan();
    image.style.transform = state.scale === 1 && !state.x && !state.y
      ? ''
      : `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
    wrap.classList.toggle('can-pan', available() && state.scale > 1);
    // Ab starker Vergrößerung zeigt die Vorschau echte Pixel statt Interpolation.
    wrap.classList.toggle('pixel-zoom', state.scale >= 4);
    controls.hidden = !available();
    levelButton.textContent = `${Math.round(state.scale * 100)} %`;
    outButton.disabled = state.scale <= minZoom + 0.001;
    inButton.disabled = state.scale >= maxZoom - 0.001;
    if (onChange) onChange();
  }

  // `focus` ist der Punkt im Vorschaufeld, der beim Zoomen an Ort und Stelle bleibt.
  function zoomTo(scale, focus) {
    const next = clamp(scale, minZoom, maxZoom);
    const base = baseRect();
    if (base && focus && next !== minZoom) {
      const centerX = base.left + base.width / 2;
      const centerY = base.top + base.height / 2;
      const factor = next / state.scale;
      state.x = (focus.x - centerX) - (focus.x - centerX - state.x) * factor;
      state.y = (focus.y - centerY) - (focus.y - centerY - state.y) * factor;
    }
    state.scale = next;
    if (next === minZoom) {
      state.x = 0;
      state.y = 0;
    }
    apply();
  }

  function pointIn(event) {
    const bounds = wrap.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  wrap.addEventListener('wheel', (event) => {
    // In der Ausgangsgröße gehört das Mausrad der Seite. Der Zoom beginnt mit
    // Strg (oder der Trackpad-Geste) und übernimmt das Rad, solange er aktiv ist.
    if (!available() || (state.scale <= minZoom && !event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    // Zeilen- und Seitenschritte auf Pixel bringen, damit alle Eingabegeräte gleich zoomen.
    const steps = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? wrap.clientHeight : 1;
    zoomTo(state.scale * Math.exp(-event.deltaY * steps * 0.0015), pointIn(event));
  }, { passive: false });

  wrap.addEventListener('pointerdown', (event) => {
    if (!available() || state.scale <= 1) return;
    const panButton = event.button === 1 || (event.button === 0 && event.altKey);
    // Ohne Modifikator verschiebt die linke Taste nur, wenn der Crop-Editor die Geste nicht nimmt.
    if (!panButton && (event.button !== 0 || (blocked && blocked()))) return;
    event.preventDefault();
    pan = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: state.x, originY: state.y };
    wrap.setPointerCapture(event.pointerId);
    wrap.classList.add('panning');
  });
  wrap.addEventListener('pointermove', (event) => {
    if (!pan || pan.pointerId !== event.pointerId) return;
    state.x = pan.originX + event.clientX - pan.startX;
    state.y = pan.originY + event.clientY - pan.startY;
    apply();
  });
  ['pointerup', 'pointercancel'].forEach((eventName) => wrap.addEventListener(eventName, (event) => {
    if (!pan || pan.pointerId !== event.pointerId) return;
    pan = undefined;
    wrap.releasePointerCapture(event.pointerId);
    wrap.classList.remove('panning');
  }));
  wrap.addEventListener('dragstart', (event) => {
    if (state.scale > 1) event.preventDefault();
  });

  inButton.addEventListener('click', () => zoomTo(nextZoomStop(state.scale, 1)));
  outButton.addEventListener('click', () => zoomTo(nextZoomStop(state.scale, -1)));
  levelButton.addEventListener('click', () => zoomTo(minZoom));

  return {
    rect,
    refresh: apply,
    reset() {
      state.scale = 1;
      state.x = 0;
      state.y = 0;
      apply();
    },
  };
}

const sourceZoom = createZoom(sourceWrap, sourcePreview, document.querySelector('#source-zoom-controls'), {
  onChange: () => syncCropEditor(),
  blocked: () => Boolean(cropDrag),
});
const resultZoom = createZoom(resultWrap, resultPreview, document.querySelector('#result-zoom-controls'));
resultPreview.addEventListener('load', () => resultZoom.refresh());

function saveSettings() {
  try {
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      width: widthInput.value,
      height: heightInput.value,
      aspectRatioLocked: aspectRatioLock.getAttribute('aria-pressed') === 'true',
      preset: document.querySelector('#preset').value,
      mode: form.elements.mode.value,
      background: document.querySelector('#background').value,
      customColor: document.querySelector('#custom-color').value,
      format: document.querySelector('#format').value,
      quality: document.querySelector('#quality').value,
      stripMetadata: form.elements.stripMetadata.checked,
      livePreview: livePreview.checked,
    }));
  } catch (_) { /* Storage is optional. */ }
}

function restoreSettings() {
  try {
    const settings = JSON.parse(localStorage.getItem(settingsStorageKey));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
    const validOption = (selector, value) => typeof value === 'string'
      && [...document.querySelector(selector).options].some((option) => option.value === value);
    const validDimension = (value, input) => Number.isInteger(Number(value))
      && Number(value) >= Number(input.min) && Number(value) <= Number(input.max);
    const quality = document.querySelector('#quality');

    if (validDimension(settings.width, widthInput)) widthInput.value = settings.width;
    if (validDimension(settings.height, heightInput)) heightInput.value = settings.height;
    if (typeof settings.aspectRatioLocked === 'boolean') setAspectRatioLock(settings.aspectRatioLocked);
    if (validOption('#preset', settings.preset)) document.querySelector('#preset').value = settings.preset;
    if (['crop', 'stretch', 'fit'].includes(settings.mode)) form.elements.mode.value = settings.mode;
    if (validOption('#background', settings.background)) document.querySelector('#background').value = settings.background;
    if (typeof settings.customColor === 'string' && /^#[0-9a-f]{6}$/i.test(settings.customColor)) {
      document.querySelector('#custom-color').value = settings.customColor;
    }
    if (validOption('#format', settings.format)) document.querySelector('#format').value = settings.format;
    if (Number.isInteger(Number(settings.quality)) && Number(settings.quality) >= Number(quality.min) && Number(settings.quality) <= Number(quality.max)) {
      quality.value = settings.quality;
    }
    if (typeof settings.stripMetadata === 'boolean') form.elements.stripMetadata.checked = settings.stripMetadata;
    if (typeof settings.livePreview === 'boolean') livePreview.checked = settings.livePreview;
  } catch (_) { /* Invalid or unavailable storage keeps the defaults. */ }
}

// Persists the settings and queues the live preview for the same change.
function settingsChanged() {
  saveSettings();
  schedulePreview();
}

chooseFile.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('click', (event) => {
  if (event.target !== chooseFile) fileInput.click();
});
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => selectFile(fileInput.files[0]));
newImage.addEventListener('click', resetImage);
resetCrop.addEventListener('click', () => {
  resetCropSelection();
  syncCropEditor();
  schedulePreview();
});
livePreview.addEventListener('change', () => {
  saveSettings();
  if (livePreview.checked) schedulePreview();
  else cancelPreview();
});

['dragenter', 'dragover'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
}));
dropZone.addEventListener('drop', (event) => {
  event.stopPropagation();
  pageDragDepth = 0;
  document.body.classList.remove('page-dragging');
  selectFile(event.dataTransfer.files[0]);
});
document.addEventListener('dragenter', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  pageDragDepth++;
  document.body.classList.add('page-dragging');
});
document.addEventListener('dragover', (event) => {
  if (hasFiles(event)) event.preventDefault();
});
document.addEventListener('dragleave', (event) => {
  if (!hasFiles(event)) return;
  pageDragDepth = Math.max(0, pageDragDepth - 1);
  if (pageDragDepth === 0) document.body.classList.remove('page-dragging');
});
document.addEventListener('drop', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  pageDragDepth = 0;
  document.body.classList.remove('page-dragging');
  selectFile(event.dataTransfer.files[0]);
});
document.addEventListener('paste', (event) => {
  const item = [...event.clipboardData.items].find((entry) => entry.type.startsWith('image/'));
  if (item) selectFile(item.getAsFile());
});

function selectFile(file) {
  clearMessage(uploadError);
  if (!file) return;
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) {
    showMessage(uploadError, 'Bitte waehlen Sie eine Bilddatei.');
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    showMessage(uploadError, 'Die Datei ist groesser als das Standardlimit von 50 MB.');
    return;
  }
  cancelPreview();
  renderedKey = undefined;
  resultPanel.hidden = true;
  if (resultURL) URL.revokeObjectURL(resultURL);
  resultURL = undefined;
  resultPreview.removeAttribute('src');
  download.removeAttribute('href');
  download.removeAttribute('download');
  document.querySelector('#result-details').textContent = '';
  resultStatus.textContent = '';
  selectedFile = file;
  newImage.hidden = false;
  setSubmitDisabled(false);
  document.querySelector('#file-status').textContent = 'Ausgewaehlt';
  document.querySelector('#source-name').textContent = file.name;
  document.querySelector('#source-format').textContent = readableFormat(file);
  document.querySelector('#source-size').textContent = formatBytes(file.size);
  sourceDetails.hidden = false;
  if (sourceURL) URL.revokeObjectURL(sourceURL);
  sourceURL = URL.createObjectURL(file);
  sourceZoom.reset();
  resultZoom.reset();
  sourcePreview.onload = () => {
    document.querySelector('#source-resolution').textContent = `${sourcePreview.naturalWidth} x ${sourcePreview.naturalHeight} px`;
    sourcePreview.hidden = false;
    sourcePlaceholder.hidden = true;
    sourceWrap.classList.remove('empty');
    zoomHint.hidden = false;
    sourceZoom.reset();
    resetCropSelection();
    syncCropEditor();
    schedulePreview();
  };
  sourcePreview.onerror = () => {
    document.querySelector('#source-resolution').textContent = 'Browser-Vorschau nicht verfuegbar';
    sourcePreview.hidden = true;
    sourcePlaceholder.textContent = 'Vorschau fuer dieses Format nicht verfuegbar';
    sourcePlaceholder.hidden = false;
    zoomHint.hidden = true;
    cropEditor.hidden = true;
    // Without browser decoding there is no crop to place, but the server can still render.
    cropState = undefined;
    schedulePreview();
  };
  sourcePreview.src = sourceURL;
}

function resetImage() {
  cancelPreview();
  renderedKey = undefined;
  if (sourceURL) URL.revokeObjectURL(sourceURL);
  if (resultURL) URL.revokeObjectURL(resultURL);
  selectedFile = undefined;
  sourceURL = undefined;
  resultURL = undefined;
  cropState = undefined;
  cropDrag = undefined;
  fileInput.value = '';
  sourcePreview.onload = null;
  sourcePreview.onerror = null;
  sourcePreview.removeAttribute('src');
  sourcePreview.hidden = true;
  sourcePlaceholder.textContent = 'Noch kein Bild ausgew\u00e4hlt';
  sourcePlaceholder.hidden = false;
  sourceWrap.classList.add('empty');
  zoomHint.hidden = true;
  sourceZoom.reset();
  resultZoom.reset();
  cropEditor.hidden = true;
  sourceDetails.hidden = true;
  document.querySelector('#file-status').textContent = 'Kein Bild';
  document.querySelectorAll('#source-details dd').forEach((detail) => { detail.textContent = ''; });
  resultPanel.hidden = true;
  resultPreview.removeAttribute('src');
  download.removeAttribute('href');
  download.removeAttribute('download');
  document.querySelector('#result-details').textContent = '';
  resultStatus.textContent = '';
  newImage.hidden = true;
  setSubmitDisabled(true);
  clearMessage(uploadError);
  clearMessage(formError);
}

function hasFiles(event) {
  return event.dataTransfer && [...event.dataTransfer.types].includes('Files');
}

const widthInput = document.querySelector('#width');
const heightInput = document.querySelector('#height');
const aspectRatioLock = document.querySelector('#aspect-ratio-lock');
let lockedAspectRatio;

document.querySelector('#preset').addEventListener('change', (event) => {
  if (event.target.value !== 'custom') {
    const [width, height] = event.target.value.split('x');
    widthInput.value = width;
    heightInput.value = height;
    if (lockedAspectRatio) lockedAspectRatio = Number(width) / Number(height);
    resetCropSelection();
    syncCropEditor();
  }
  settingsChanged();
});
widthInput.addEventListener('input', () => {
  document.querySelector('#preset').value = 'custom';
  if (lockedAspectRatio) syncLockedDimension(widthInput);
  resetCropSelection();
  syncCropEditor();
  settingsChanged();
});
heightInput.addEventListener('input', () => {
  document.querySelector('#preset').value = 'custom';
  if (lockedAspectRatio) syncLockedDimension(heightInput);
  resetCropSelection();
  syncCropEditor();
  settingsChanged();
});
aspectRatioLock.addEventListener('click', () => {
  setAspectRatioLock(!lockedAspectRatio);
  settingsChanged();
});
document.querySelectorAll('input[name="mode"]').forEach((input) => input.addEventListener('change', () => {
  resetCropSelection();
  syncConditionalOptions();
  settingsChanged();
}));
document.querySelector('#background').addEventListener('change', () => {
  syncConditionalOptions();
  settingsChanged();
});
document.querySelector('#custom-color').addEventListener('input', settingsChanged);
document.querySelector('#format').addEventListener('change', () => {
  syncConditionalOptions();
  settingsChanged();
});
document.querySelector('#quality').addEventListener('input', (event) => {
  document.querySelector('#quality-value').textContent = event.target.value;
  settingsChanged();
});
form.elements.stripMetadata.addEventListener('change', settingsChanged);

function syncConditionalOptions() {
  const mode = form.elements.mode.value;
  const cropEnabled = mode === 'crop' || mode === 'stretch';
  document.querySelector('#crop-options').hidden = !cropEnabled;
  document.querySelector('#crop-help').textContent = mode === 'crop'
    ? 'Der Rahmen folgt dem Zielseitenverhaeltnis. Ziehen Sie ihn zum Verschieben oder die Ecken zum Anpassen.'
    : 'Ziehen Sie einen freien Rahmen auf oder passen Sie ihn an den Ecken an. Halten Sie Umschalt gedrueckt und ziehen Sie innerhalb des Rahmens zum Verschieben.';
  document.querySelector('#fit-options').hidden = mode !== 'fit';
  const isCustom = document.querySelector('#background').value === 'custom';
  document.querySelector('#custom-color-wrap').hidden = mode !== 'fit' || !isCustom;
  const format = document.querySelector('#format').value;
  const transparentOption = document.querySelector('#background option[value="transparent"]');
  const jpeg = format === 'jpeg';
  transparentOption.disabled = jpeg;
  const backgroundHelp = document.querySelector('#background-help');
  if (jpeg && document.querySelector('#background').value === 'transparent') {
    document.querySelector('#background').value = 'black';
    backgroundHelp.hidden = false;
  } else {
    backgroundHelp.hidden = true;
  }
  const lossy = ['jpeg', 'webp', 'avif'].includes(format);
  document.querySelector('#quality-wrap').hidden = !lossy;
  syncCropEditor();
}
restoreSettings();
syncConditionalOptions();
document.querySelector('#quality-value').textContent = document.querySelector('#quality').value;

function setAspectRatioLock(locked) {
  if (locked) {
    const width = Number(widthInput.value);
    const height = Number(heightInput.value);
    if (!width || !height) return;
    lockedAspectRatio = width / height;
  } else {
    lockedAspectRatio = undefined;
  }
  aspectRatioLock.setAttribute('aria-pressed', String(locked));
  aspectRatioLock.textContent = locked ? 'Seitenverhaeltnis entsperren' : 'Seitenverhaeltnis sperren';
}

function syncLockedDimension(changedInput) {
  if (!lockedAspectRatio || !changedInput.value) return;
  const otherInput = changedInput === widthInput ? heightInput : widthInput;
  const requestedValue = changedInput === widthInput
    ? Math.round(Number(changedInput.value) / lockedAspectRatio)
    : Math.round(Number(changedInput.value) * lockedAspectRatio);
  otherInput.value = clamp(requestedValue, Number(otherInput.min), Number(otherInput.max));
}

function resetCropSelection() {
  if (form.elements.mode.value === 'stretch') {
    cropState = { x: 0, y: 0, width: 1, height: 1 };
    return;
  }
  const sourceRatio = sourcePreview.naturalWidth / sourcePreview.naturalHeight;
  const targetRatio = Number(widthInput.value) / Number(heightInput.value);
  if (!Number.isFinite(sourceRatio) || !Number.isFinite(targetRatio) || targetRatio <= 0) return;
  if (sourceRatio > targetRatio) {
    const width = targetRatio / sourceRatio;
    cropState = { x: (1 - width) / 2, y: 0, width, height: 1 };
  } else {
    const height = sourceRatio / targetRatio;
    cropState = { x: 0, y: (1 - height) / 2, width: 1, height };
  }
}

function syncCropEditor() {
  const cropEnabled = form.elements.mode.value === 'crop' || form.elements.mode.value === 'stretch';
  if (!cropEnabled || sourcePreview.hidden || !sourcePreview.naturalWidth || !cropState) {
    cropEditor.hidden = true;
    return;
  }
  // Der Rahmen liegt genau auf der Bildfläche, also folgt er Zoom und Verschiebung.
  const area = sourceZoom.rect();
  if (!area) {
    cropEditor.hidden = true;
    return;
  }
  cropEditor.style.width = `${area.width}px`;
  cropEditor.style.height = `${area.height}px`;
  cropEditor.style.left = `${area.left}px`;
  cropEditor.style.top = `${area.top}px`;
  cropSelection.style.left = `${cropState.x * 100}%`;
  cropSelection.style.top = `${cropState.y * 100}%`;
  cropSelection.style.width = `${cropState.width * 100}%`;
  cropSelection.style.height = `${cropState.height * 100}%`;
  cropEditor.hidden = false;
}

cropEditor.addEventListener('pointerdown', (event) => {
  if (!sourcePreview.naturalWidth || event.button !== 0) return;
  // Alt + Ziehen verschiebt den Zoomausschnitt, statt den Crop zu verändern.
  if (event.altKey) return;
  // Keeps the browser from starting a text selection or a native image drag on top of the overlay.
  event.preventDefault();
  const point = cropPoint(event);
  cropHoverPoint = point;
  syncCropCursor(event.shiftKey);
  const handle = event.target.closest('[data-crop-handle]');
  const startState = { ...cropState };
  const insideSelection = point.x >= cropState.x && point.x <= cropState.x + cropState.width
    && point.y >= cropState.y && point.y <= cropState.y + cropState.height;
  const stretchMode = form.elements.mode.value === 'stretch';
  const moveSelection = stretchMode && event.shiftKey && insideSelection;
  const drawSelection = stretchMode && !handle && !moveSelection;
  if (!handle && !insideSelection && !drawSelection) return;
  if (drawSelection) cropState = { x: point.x, y: point.y, width: 0, height: 0 };
  cropDrag = {
    pointerId: event.pointerId,
    action: handle ? handle.dataset.cropHandle : drawSelection ? 'draw' : 'move',
    startX: point.x,
    startY: point.y,
    startState,
  };
  cropEditor.setPointerCapture(event.pointerId);
  syncCropEditor();
});
cropEditor.addEventListener('pointermove', (event) => {
  const point = cropPoint(event);
  cropHoverPoint = point;
  if (!cropDrag || cropDrag.pointerId !== event.pointerId || !cropState) {
    syncCropCursor(event.shiftKey);
    return;
  }
  if (cropDrag.action === 'draw') {
    cropState.x = Math.min(cropDrag.startX, point.x);
    cropState.y = Math.min(cropDrag.startY, point.y);
    cropState.width = Math.abs(point.x - cropDrag.startX);
    cropState.height = Math.abs(point.y - cropDrag.startY);
  } else if (cropDrag.action === 'move') {
    cropState.x = clamp(cropDrag.startState.x + point.x - cropDrag.startX, 0, 1 - cropDrag.startState.width);
    cropState.y = clamp(cropDrag.startState.y + point.y - cropDrag.startY, 0, 1 - cropDrag.startState.height);
  } else {
    resizeCropSelection(point);
  }
  syncCropEditor();
  syncCropCursor(event.shiftKey);
  // Keeps pushing the preview out while the pointer keeps changing the crop.
  schedulePreview();
});
cropEditor.addEventListener('dragstart', (event) => event.preventDefault());
cropEditor.addEventListener('pointerup', endCropDrag);
cropEditor.addEventListener('pointercancel', endCropDrag);
cropEditor.addEventListener('pointerleave', () => {
  cropHoverPoint = undefined;
  cropEditor.classList.remove('move-ready');
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Shift') syncCropCursor(true);
});
document.addEventListener('keyup', (event) => {
  if (event.key === 'Shift') syncCropCursor(false);
});
// Das Vorschaufeld aendert seine Groesse auch ohne Fensteraenderung, etwa wenn
// das Ergebnis-Panel erscheint und die Spalte schmaler wird. Der Crop-Rahmen
// muss dann neu vermessen werden, sonst bleibt er auf der alten Groesse stehen.
function remeasurePreviews() {
  sourceZoom.refresh();
  resultZoom.refresh();
}
if (typeof ResizeObserver === 'function') {
  const observer = new ResizeObserver(remeasurePreviews);
  observer.observe(sourceWrap);
  observer.observe(resultWrap);
} else {
  window.addEventListener('resize', remeasurePreviews);
}

function endCropDrag(event) {
  if (!cropDrag || cropDrag.pointerId !== event.pointerId) return;
  cropDrag = undefined;
  cropEditor.releasePointerCapture(event.pointerId);
  if (cropState.width < 0.002 || cropState.height < 0.002) resetCropSelection();
  syncCropEditor();
  schedulePreview();
}

function resizeCropSelection(point) {
  const { action, startState } = cropDrag;
  const right = startState.x + startState.width;
  const bottom = startState.y + startState.height;
  if (form.elements.mode.value === 'stretch') {
    if (action === 'top-left') {
      cropState.x = clamp(point.x, 0, right);
      cropState.y = clamp(point.y, 0, bottom);
      cropState.width = right - cropState.x;
      cropState.height = bottom - cropState.y;
    } else if (action === 'top-right') {
      cropState.x = startState.x;
      cropState.y = clamp(point.y, 0, bottom);
      cropState.width = clamp(point.x, startState.x, 1) - startState.x;
      cropState.height = bottom - cropState.y;
    } else if (action === 'bottom-left') {
      cropState.x = clamp(point.x, 0, right);
      cropState.y = startState.y;
      cropState.width = right - cropState.x;
      cropState.height = clamp(point.y, startState.y, 1) - startState.y;
    } else if (action === 'bottom-right') {
      cropState.x = startState.x;
      cropState.y = startState.y;
      cropState.width = clamp(point.x, startState.x, 1) - startState.x;
      cropState.height = clamp(point.y, startState.y, 1) - startState.y;
    }
    return;
  }
  const fromLeft = action === 'top-left' || action === 'bottom-left';
  const fromTop = action === 'top-left' || action === 'top-right';
  const anchorX = fromLeft ? right : startState.x;
  const anchorY = fromTop ? bottom : startState.y;
  const sourceRatio = sourcePreview.naturalWidth / sourcePreview.naturalHeight;
  const targetRatio = Number(widthInput.value) / Number(heightInput.value);
  const widthPerHeight = targetRatio / sourceRatio;
  if (!Number.isFinite(widthPerHeight) || widthPerHeight <= 0) return;

  const requestedHeight = Math.max(Math.abs(point.x - anchorX) / widthPerHeight, Math.abs(point.y - anchorY));
  const maximumHeight = Math.min(fromLeft ? anchorX / widthPerHeight : (1 - anchorX) / widthPerHeight, fromTop ? anchorY : 1 - anchorY);
  const height = clamp(requestedHeight, 0, maximumHeight);
  const width = height * widthPerHeight;
  cropState = {
    x: fromLeft ? anchorX - width : anchorX,
    y: fromTop ? anchorY - height : anchorY,
    width,
    height,
  };
}

function syncCropCursor(shiftKey) {
  const insideSelection = cropHoverPoint && cropState
    && cropHoverPoint.x >= cropState.x && cropHoverPoint.x <= cropState.x + cropState.width
    && cropHoverPoint.y >= cropState.y && cropHoverPoint.y <= cropState.y + cropState.height;
  cropEditor.classList.toggle('move-ready', form.elements.mode.value === 'stretch' && Boolean(shiftKey && insideSelection));
}

function cropPoint(event) {
  const bounds = cropEditor.getBoundingClientRect();
  return { x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1), y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1) };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  generate(false);
});

// Restarts the idle timer; the render only runs once editing has actually stopped.
function schedulePreview() {
  clearTimeout(previewTimer);
  if (!livePreview.checked || !selectedFile) {
    previewPending = false;
    syncResultState();
    return;
  }
  previewPending = true;
  previewTimer = setTimeout(runPreview, previewDelay);
  syncResultState();
}

function cancelPreview() {
  clearTimeout(previewTimer);
  previewPending = false;
  if (previewController) {
    const controller = previewController;
    previewController = undefined;
    controller.abort();
  }
  syncResultState();
}

function runPreview() {
  previewPending = false;
  // A held pointer means the crop is still being edited, so wait for the drag to end.
  if (cropDrag) {
    schedulePreview();
    return;
  }
  generate(true);
}

async function generate(preview) {
  if (!preview) {
    clearMessage(formError);
    resultStatus.textContent = '';
  }
  if (!selectedFile) {
    if (!preview) showMessage(formError, 'Bitte waehlen Sie zuerst ein Bild aus.');
    return;
  }
  const width = Number(widthInput.value);
  const height = Number(heightInput.value);
  if (!validDimension(width, widthInput) || !validDimension(height, heightInput)) {
    if (!preview) showMessage(formError, `Breite und Hoehe muessen ganze Zahlen zwischen ${widthInput.min} und ${widthInput.max} sein.`);
    return;
  }
  // A live preview is the real output, so an unchanged request needs no round trip.
  const key = renderKey();
  if (key === renderedKey && resultURL) {
    if (!preview) revealResult();
    syncResultState();
    return;
  }
  if (preview && busy) {
    schedulePreview();
    return;
  }
  cancelPreview();
  const controller = new AbortController();
  if (preview) previewController = controller;
  else setBusy(true);
  syncResultState();
  try {
    const response = await fetch('/api/resize', { method: 'POST', body: buildRequest(), signal: controller.signal });
    if (!response.ok) {
      let message = 'Das Bild konnte nicht verarbeitet werden.';
      try { message = (await response.json()).error || message; } catch (_) { /* controlled fallback */ }
      throw new Error(message);
    }
    const blob = await response.blob();
    if (preview && previewController !== controller) return;
    const result = applyResult(blob, response, width, height);
    renderedKey = key;
    clearMessage(formError);
    if (!preview) {
      revealResult();
      resultStatus.textContent = `Bild erfolgreich erstellt: ${result.width} x ${result.height} Pixel, ${form.elements.format.value.toUpperCase()}, ${result.name}.`;
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
    showMessage(formError, error.message);
    if (preview) resultState.textContent = 'Vorschau fehlgeschlagen';
    return;
  } finally {
    if (previewController === controller) previewController = undefined;
    if (!preview) setBusy(false);
  }
  syncResultState();
}

function buildRequest() {
  const data = new FormData(form);
  data.set('file', selectedFile, selectedFile.name);
  data.set('width', widthInput.value);
  data.set('height', heightInput.value);
  if (manualCropActive()) {
    data.set('cropLeft', cropState.x.toFixed(6));
    data.set('cropTop', cropState.y.toFixed(6));
    data.set('cropWidth', cropState.width.toFixed(6));
    data.set('cropHeight', cropState.height.toFixed(6));
  }
  if (data.get('background') === 'custom') data.set('background', document.querySelector('#custom-color').value);
  data.set('stripMetadata', String(form.elements.stripMetadata.checked));
  return data;
}

function applyResult(blob, response, width, height) {
  if (resultURL) URL.revokeObjectURL(resultURL);
  resultURL = URL.createObjectURL(blob);
  resultPreview.src = resultURL;
  const name = filenameFromResponse(response.headers.get('content-disposition')) || outputName(selectedFile.name, width, height, form.elements.format.value);
  download.href = resultURL;
  download.download = name;
  const outputWidth = Number(response.headers.get('x-image-width')) || width;
  const outputHeight = Number(response.headers.get('x-image-height')) || height;
  document.querySelector('#result-details').textContent = `${name} / ${outputWidth} x ${outputHeight} px / ${form.elements.format.value.toUpperCase()} / ${formatBytes(blob.size)}`;
  resultPanel.hidden = false;
  return { name, width: outputWidth, height: outputHeight };
}

function revealResult() {
  resultPanel.hidden = false;
  resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.querySelector('#result-heading').focus({ preventScroll: true });
}

function manualCropActive() {
  return Boolean(cropState) && (form.elements.mode.value === 'crop' || form.elements.mode.value === 'stretch');
}

// Identifies the output a request would produce, so identical work is never repeated.
function renderKey() {
  if (!selectedFile) return '';
  const parts = [
    selectedFile.name, selectedFile.size, selectedFile.lastModified,
    widthInput.value, heightInput.value, form.elements.mode.value,
    form.elements.format.value, document.querySelector('#quality').value,
    document.querySelector('#background').value, document.querySelector('#custom-color').value,
    String(form.elements.stripMetadata.checked),
  ];
  if (manualCropActive()) {
    parts.push(cropState.x.toFixed(6), cropState.y.toFixed(6), cropState.width.toFixed(6), cropState.height.toFixed(6));
  }
  return parts.join('|');
}

function syncResultState() {
  const updating = previewPending || Boolean(previewController);
  const stale = Boolean(resultURL) && renderKey() !== renderedKey;
  resultPanel.classList.toggle('stale', updating || stale);
  resultState.classList.toggle('success', !updating && !stale);
  resultState.classList.toggle('pending', updating || stale);
  resultState.textContent = updating ? 'Vorschau wird aktualisiert' : stale ? 'Nicht aktuell' : 'Bereit';
}

function validDimension(value, input) {
  return Number.isInteger(value) && value >= Number(input.min) && value <= Number(input.max);
}

function setBusy(value) {
  busy = value;
  setSubmitDisabled(value || !selectedFile);
  newImage.disabled = value;
  loading.hidden = !value;
}
function setSubmitDisabled(disabled) {
  submitButtons.forEach((button) => { button.disabled = disabled; });
}
function showMessage(element, message) { element.textContent = message; element.hidden = false; }
function clearMessage(element) { element.hidden = true; element.textContent = ''; }
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
function readableFormat(file) {
  if (file.type) return file.type.replace('image/', '').toUpperCase();
  const extension = file.name.split('.').pop();
  return extension ? extension.toUpperCase() : 'Unbekannt';
}
function filenameFromResponse(disposition) {
  const match = disposition && disposition.match(/filename="?([^";]+)"?/i);
  return match ? match[1] : '';
}
function outputName(name, width, height, format) {
  const base = name.replace(/\.[^.]+$/, '') || 'image';
  return `${base}-${width}x${height}.${format === 'jpeg' ? 'jpg' : format}`;
}
