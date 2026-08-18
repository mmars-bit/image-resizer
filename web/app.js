const form = document.querySelector('#resize-form');
const fileInput = document.querySelector('#file');
const dropZone = document.querySelector('#drop-zone');
const chooseFile = document.querySelector('#choose-file');
const submit = document.querySelector('#submit');
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
let selectedFile;
let sourceURL;
let resultURL;

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
dropZone.addEventListener('drop', (event) => selectFile(event.dataTransfer.files[0]));
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
  submit.disabled = false;
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
  };
  sourcePreview.onerror = () => {
    document.querySelector('#source-resolution').textContent = 'Browser-Vorschau nicht verfuegbar';
    sourcePreview.hidden = true;
    sourcePlaceholder.textContent = 'Vorschau fuer dieses Format nicht verfuegbar';
    sourcePlaceholder.hidden = false;
  };
  sourcePreview.src = sourceURL;
}

document.querySelector('#preset').addEventListener('change', (event) => {
  if (event.target.value === 'custom') return;
  const [width, height] = event.target.value.split('x');
  document.querySelector('#width').value = width;
  document.querySelector('#height').value = height;
});
['#width', '#height'].forEach((selector) => document.querySelector(selector).addEventListener('input', () => {
  document.querySelector('#preset').value = 'custom';
}));
document.querySelectorAll('input[name="mode"]').forEach((input) => input.addEventListener('change', syncConditionalOptions));
document.querySelector('#background').addEventListener('change', syncConditionalOptions);
document.querySelector('#format').addEventListener('change', syncConditionalOptions);
document.querySelector('#quality').addEventListener('input', (event) => {
  document.querySelector('#quality-value').textContent = event.target.value;
});

function syncConditionalOptions() {
  const mode = form.elements.mode.value;
  document.querySelector('#crop-options').hidden = mode !== 'crop';
  document.querySelector('#fit-options').hidden = mode !== 'fit';
  const isCustom = document.querySelector('#background').value === 'custom';
  document.querySelector('#custom-color-wrap').hidden = mode !== 'fit' || !isCustom;
  const lossy = ['jpeg', 'webp', 'avif'].includes(document.querySelector('#format').value);
  document.querySelector('#quality-wrap').hidden = !lossy;
  if (mode === 'fit' && document.querySelector('#format').value === 'jpeg' && document.querySelector('#background').value === 'transparent') {
    document.querySelector('#background').value = 'black';
  }
}
syncConditionalOptions();

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
    document.querySelector('#result-details').textContent = `${width} x ${height} px / ${form.elements.format.value.toUpperCase()} / ${formatBytes(blob.size)}`;
    resultPanel.hidden = false;
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    showMessage(formError, error.message);
  } finally {
    setBusy(false);
  }
});

function setBusy(busy) {
  submit.disabled = busy || !selectedFile;
  loading.hidden = !busy;
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
