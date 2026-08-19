const form = document.querySelector('#resize-form');
const fileInput = document.querySelector('#file');
const dropZone = document.querySelector('#drop-zone');
const chooseFile = document.querySelector('#choose-file');
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
const cropEditor = document.querySelector('#crop-editor');
const cropSelection = document.querySelector('#crop-selection');
let selectedFile;
let sourceURL;
let resultURL;
let cropState;
let cropDrag;
let pageDragDepth = 0;

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
  selectedFile = file;
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

function hasFiles(event) {
  return event.dataTransfer && [...event.dataTransfer.types].includes('Files');
}

const widthInput = document.querySelector('#width');
const heightInput = document.querySelector('#height');
const aspectRatio = document.querySelector('#aspect-ratio');

document.querySelector('#preset').addEventListener('change', (event) => {
  if (event.target.value === 'custom') return;
  const [width, height] = event.target.value.split('x');
  widthInput.value = width;
  heightInput.value = height;
  syncAspectRatioFromDimensions();
  resetCropSelection();
  syncCropEditor();
});
widthInput.addEventListener('input', () => {
  document.querySelector('#preset').value = 'custom';
  applyAspectRatio();
  resetCropSelection();
  syncCropEditor();
});
heightInput.addEventListener('input', () => {
  document.querySelector('#preset').value = 'custom';
  syncAspectRatioFromDimensions();
  resetCropSelection();
  syncCropEditor();
});
aspectRatio.addEventListener('change', () => {
  applyAspectRatio();
  document.querySelector('#preset').value = 'custom';
  resetCropSelection();
  syncCropEditor();
});
document.querySelectorAll('input[name="mode"]').forEach((input) => input.addEventListener('change', () => {
  resetCropSelection();
  syncConditionalOptions();
}));
document.querySelector('#background').addEventListener('change', syncConditionalOptions);
document.querySelector('#format').addEventListener('change', syncConditionalOptions);
document.querySelector('#quality').addEventListener('input', (event) => {
  document.querySelector('#quality-value').textContent = event.target.value;
});

function syncConditionalOptions() {
  const mode = form.elements.mode.value;
  const cropEnabled = mode === 'crop' || mode === 'stretch';
  document.querySelector('#crop-options').hidden = !cropEnabled;
  document.querySelector('#crop-help').textContent = mode === 'crop'
    ? 'Ziehen Sie in der Originalvorschau einen freien Rahmen. Der Ausschnitt wird in seiner nativen Aufloesung exportiert.'
    : 'Ziehen Sie einen freien Rahmen. Der Ausschnitt wird auf die eingestellte Zielaufloesung gedehnt.';
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
syncConditionalOptions();
syncAspectRatioFromDimensions();

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
  if (!sourcePreview.naturalWidth) return;
  const point = cropPoint(event);
  cropState = { x: point.x, y: point.y, width: 0, height: 0 };
  cropDrag = { pointerId: event.pointerId, startX: point.x, startY: point.y };
  cropEditor.setPointerCapture(event.pointerId);
  syncCropEditor();
});
cropEditor.addEventListener('pointermove', (event) => {
  if (!cropDrag || cropDrag.pointerId !== event.pointerId || !cropState) return;
  const point = cropPoint(event);
  cropState.x = Math.min(cropDrag.startX, point.x);
  cropState.y = Math.min(cropDrag.startY, point.y);
  cropState.width = Math.abs(point.x - cropDrag.startX);
  cropState.height = Math.abs(point.y - cropDrag.startY);
  syncCropEditor();
});
cropEditor.addEventListener('pointerup', endCropDrag);
cropEditor.addEventListener('pointercancel', endCropDrag);
window.addEventListener('resize', syncCropEditor);

function endCropDrag(event) {
  if (!cropDrag || cropDrag.pointerId !== event.pointerId) return;
  cropDrag = undefined;
  cropEditor.releasePointerCapture(event.pointerId);
  if (cropState.width < 0.002 || cropState.height < 0.002) resetCropSelection();
  syncCropEditor();
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
    document.querySelector('#result-details').textContent = `${outputWidth} x ${outputHeight} px / ${form.elements.format.value.toUpperCase()} / ${formatBytes(blob.size)}`;
    resultPanel.hidden = false;
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    showMessage(formError, error.message);
  } finally {
    setBusy(false);
  }
});

function setBusy(busy) {
  setSubmitDisabled(busy || !selectedFile);
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
