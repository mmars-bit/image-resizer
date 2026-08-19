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
const cropEditor = document.querySelector('#crop-editor');
const cropSelection = document.querySelector('#crop-selection');
const resetCrop = document.querySelector('#reset-crop');
let selectedFile;
let sourceURL;
let resultURL;
let cropState;
let cropDrag;
let cropHoverPoint;
let pageDragDepth = 0;
const settingsStorageKey = 'image-resizer.settings';

function saveSettings() {
  try {
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      width: widthInput.value,
      height: heightInput.value,
      aspectRatio: aspectRatio.value,
      preset: document.querySelector('#preset').value,
      mode: form.elements.mode.value,
      background: document.querySelector('#background').value,
      customColor: document.querySelector('#custom-color').value,
      format: document.querySelector('#format').value,
      quality: document.querySelector('#quality').value,
      stripMetadata: form.elements.stripMetadata.checked,
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
    if (validOption('#aspect-ratio', settings.aspectRatio)) aspectRatio.value = settings.aspectRatio;
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
  } catch (_) { /* Invalid or unavailable storage keeps the defaults. */ }
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
  sourcePreview.onload = () => {
    document.querySelector('#source-resolution').textContent = `${sourcePreview.naturalWidth} x ${sourcePreview.naturalHeight} px`;
    sourcePreview.hidden = false;
    sourcePlaceholder.hidden = true;
    sourceWrap.classList.remove('empty');
    resetCropSelection();
    syncCropEditor();
  };
  sourcePreview.onerror = () => {
    document.querySelector('#source-resolution').textContent = 'Browser-Vorschau nicht verfuegbar';
    sourcePreview.hidden = true;
    sourcePlaceholder.textContent = 'Vorschau fuer dieses Format nicht verfuegbar';
    sourcePlaceholder.hidden = false;
    cropEditor.hidden = true;
  };
  sourcePreview.src = sourceURL;
}

function resetImage() {
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
const aspectRatio = document.querySelector('#aspect-ratio');

document.querySelector('#preset').addEventListener('change', (event) => {
  if (event.target.value !== 'custom') {
    const [width, height] = event.target.value.split('x');
    widthInput.value = width;
    heightInput.value = height;
    syncAspectRatioFromDimensions();
    resetCropSelection();
    syncCropEditor();
  }
  saveSettings();
});
widthInput.addEventListener('input', () => {
  document.querySelector('#preset').value = 'custom';
  applyAspectRatio();
  resetCropSelection();
  syncCropEditor();
  saveSettings();
});
heightInput.addEventListener('input', () => {
  document.querySelector('#preset').value = 'custom';
  syncAspectRatioFromDimensions();
  resetCropSelection();
  syncCropEditor();
  saveSettings();
});
aspectRatio.addEventListener('change', () => {
  applyAspectRatio();
  document.querySelector('#preset').value = 'custom';
  resetCropSelection();
  syncCropEditor();
  saveSettings();
});
document.querySelectorAll('input[name="mode"]').forEach((input) => input.addEventListener('change', () => {
  resetCropSelection();
  syncConditionalOptions();
  saveSettings();
}));
document.querySelector('#background').addEventListener('change', () => {
  syncConditionalOptions();
  saveSettings();
});
document.querySelector('#custom-color').addEventListener('input', saveSettings);
document.querySelector('#format').addEventListener('change', () => {
  syncConditionalOptions();
  saveSettings();
});
document.querySelector('#quality').addEventListener('input', (event) => {
  document.querySelector('#quality-value').textContent = event.target.value;
  saveSettings();
});
form.elements.stripMetadata.addEventListener('change', saveSettings);

function syncConditionalOptions() {
  const mode = form.elements.mode.value;
  const cropEnabled = mode === 'crop' || mode === 'stretch';
  document.querySelector('#crop-options').hidden = !cropEnabled;
  document.querySelector('#crop-help').textContent = mode === 'crop'
    ? 'Ziehen Sie einen freien Rahmen oder an den Ecken zum Skalieren. Halten Sie Umschalt gedrueckt und ziehen Sie innerhalb der Auswahl zum Verschieben. Auswahl zuruecksetzen stellt das ganze Bild wieder her. Der Ausschnitt wird in seiner nativen Aufloesung exportiert.'
    : 'Ziehen Sie einen freien Rahmen oder an den Ecken zum Skalieren. Halten Sie Umschalt gedrueckt und ziehen Sie innerhalb der Auswahl zum Verschieben. Auswahl zuruecksetzen stellt das ganze Bild wieder her. Der Ausschnitt wird auf die eingestellte Zielaufloesung gedehnt.';
  setTargetSizeEnabled(mode !== 'crop');
  document.querySelector('#fit-options').hidden = mode !== 'fit';
  const isCustom = document.querySelector('#background').value === 'custom';
  document.querySelector('#custom-color-wrap').hidden = mode !== 'fit' || !isCustom;
  const lossy = ['jpeg', 'webp', 'avif'].includes(document.querySelector('#format').value);
  document.querySelector('#quality-wrap').hidden = !lossy;
  if (mode === 'fit' && document.querySelector('#format').value === 'jpeg' && document.querySelector('#background').value === 'transparent') {
    document.querySelector('#background').value = 'black';
  }
  syncCropEditor();
}
restoreSettings();
syncConditionalOptions();
document.querySelector('#quality-value').textContent = document.querySelector('#quality').value;

function applyAspectRatio() {
  if (aspectRatio.value === 'free' || !widthInput.value) return;
  const [widthPart, heightPart] = aspectRatio.value.split(':').map(Number);
  const requestedWidth = Number(widthInput.value);
  const maximumHeight = Number(heightInput.max);
  const outputHeight = Math.round(requestedWidth * heightPart / widthPart);
  if (outputHeight > maximumHeight) {
    widthInput.value = Math.max(1, Math.floor(maximumHeight * widthPart / heightPart));
  }
  heightInput.value = Math.max(1, Math.round(Number(widthInput.value) * heightPart / widthPart));
}

function syncAspectRatioFromDimensions() {
  const width = Number(widthInput.value);
  const height = Number(heightInput.value);
  if (!width || !height) {
    aspectRatio.value = 'free';
    return;
  }
  const matchingRatio = [...aspectRatio.options].find((option) => {
    if (option.value === 'free') return false;
    const [widthPart, heightPart] = option.value.split(':').map(Number);
    return width * heightPart === height * widthPart;
  });
  aspectRatio.value = matchingRatio ? matchingRatio.value : 'free';
}

function resetCropSelection() {
  if (!sourcePreview.naturalWidth || !sourcePreview.naturalHeight) return;
  cropState = { x: 0, y: 0, width: 1, height: 1 };
}

function syncCropEditor() {
  const cropEnabled = form.elements.mode.value === 'crop' || form.elements.mode.value === 'stretch';
  if (!cropEnabled || sourcePreview.hidden || !sourcePreview.naturalWidth || !cropState) {
    cropEditor.hidden = true;
    return;
  }
  const sourceAspect = sourcePreview.naturalWidth / sourcePreview.naturalHeight;
  const containerWidth = sourceWrap.clientWidth;
  const containerHeight = sourceWrap.clientHeight;
  const width = Math.min(containerWidth, containerHeight * sourceAspect);
  const height = width / sourceAspect;
  cropEditor.style.width = `${width}px`;
  cropEditor.style.height = `${height}px`;
  cropEditor.style.left = `${(containerWidth - width) / 2}px`;
  cropEditor.style.top = `${(containerHeight - height) / 2}px`;
  cropSelection.style.left = `${cropState.x * 100}%`;
  cropSelection.style.top = `${cropState.y * 100}%`;
  cropSelection.style.width = `${cropState.width * 100}%`;
  cropSelection.style.height = `${cropState.height * 100}%`;
  cropEditor.hidden = false;
}

cropEditor.addEventListener('pointerdown', (event) => {
  if (!sourcePreview.naturalWidth || event.button !== 0) return;
  const point = cropPoint(event);
  cropHoverPoint = point;
  syncCropCursor(event.shiftKey);
  const handle = event.target.closest('[data-crop-handle]');
  const startState = { ...cropState };
  const insideSelection = point.x >= cropState.x && point.x <= cropState.x + cropState.width
    && point.y >= cropState.y && point.y <= cropState.y + cropState.height;
  const moveSelection = event.shiftKey && insideSelection;
  if (!handle && !moveSelection) cropState = { x: point.x, y: point.y, width: 0, height: 0 };
  cropDrag = {
    pointerId: event.pointerId,
    action: handle ? handle.dataset.cropHandle : moveSelection ? 'move' : 'draw',
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
});
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
window.addEventListener('resize', syncCropEditor);

function endCropDrag(event) {
  if (!cropDrag || cropDrag.pointerId !== event.pointerId) return;
  cropDrag = undefined;
  cropEditor.releasePointerCapture(event.pointerId);
  if (cropState.width < 0.002 || cropState.height < 0.002) resetCropSelection();
  syncCropEditor();
}

function resizeCropSelection(point) {
  const { action, startState } = cropDrag;
  const right = startState.x + startState.width;
  const bottom = startState.y + startState.height;
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
}

function syncCropCursor(shiftKey) {
  const insideSelection = cropHoverPoint && cropState
    && cropHoverPoint.x >= cropState.x && cropHoverPoint.x <= cropState.x + cropState.width
    && cropHoverPoint.y >= cropState.y && cropHoverPoint.y <= cropState.y + cropState.height;
  cropEditor.classList.toggle('move-ready', Boolean(shiftKey && insideSelection));
}

function cropPoint(event) {
  const bounds = cropEditor.getBoundingClientRect();
  return { x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1), y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1) };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage(formError);
  resultStatus.textContent = '';
  if (!selectedFile) {
    showMessage(formError, 'Bitte waehlen Sie zuerst ein Bild aus.');
    return;
  }
  const width = Number(form.elements.width.value);
  const height = Number(form.elements.height.value);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    showMessage(formError, 'Breite und Hoehe muessen positive ganze Zahlen sein.');
    return;
  }
  setBusy(true);
  try {
    const data = new FormData(form);
    data.set('file', selectedFile, selectedFile.name);
    // Disabled target-size controls in native Crop mode are still required by the API.
    data.set('width', widthInput.value);
    data.set('height', heightInput.value);
    if ((form.elements.mode.value === 'crop' || form.elements.mode.value === 'stretch') && cropState) {
      data.set('cropLeft', cropState.x.toFixed(6));
      data.set('cropTop', cropState.y.toFixed(6));
      data.set('cropWidth', cropState.width.toFixed(6));
      data.set('cropHeight', cropState.height.toFixed(6));
    }
    if (data.get('background') === 'custom') data.set('background', document.querySelector('#custom-color').value);
    data.set('stripMetadata', String(form.elements.stripMetadata.checked));
    const response = await fetch('/api/resize', { method: 'POST', body: data });
    if (!response.ok) {
      let message = 'Das Bild konnte nicht verarbeitet werden.';
      try { message = (await response.json()).error || message; } catch (_) { /* controlled fallback */ }
      throw new Error(message);
    }
    const blob = await response.blob();
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
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.querySelector('#result-heading').focus({ preventScroll: true });
    resultStatus.textContent = `Bild erfolgreich erstellt: ${outputWidth} x ${outputHeight} Pixel, ${form.elements.format.value.toUpperCase()}, ${name}.`;
  } catch (error) {
    showMessage(formError, error.message);
  } finally {
    setBusy(false);
  }
});

function setBusy(busy) {
  setSubmitDisabled(busy || !selectedFile);
  newImage.disabled = busy;
  loading.hidden = !busy;
}
function setSubmitDisabled(disabled) {
  submitButtons.forEach((button) => { button.disabled = disabled; });
}
function setTargetSizeEnabled(enabled) {
  const targetSettings = document.querySelector('#target-size-settings');
  targetSettings.classList.toggle('is-disabled', !enabled);
  targetSettings.querySelectorAll('input, select').forEach((control) => { control.disabled = !enabled; });
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
