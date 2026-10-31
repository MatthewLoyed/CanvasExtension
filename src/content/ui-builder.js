/**
 * ui-builder.js
 * Extracted DOM creation logic for Canvas Downloader Extension
 */

window.CanvasDownloaderUI = window.CanvasDownloaderUI || {};

window.CanvasDownloaderUI.createOfflineDialog = function () {
  // A shadow boundary keeps Canvas themes and global extension CSS out of the dialog.
  const host = document.createElement('div'); host.id = 'cdl-offline-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = window.CanvasOfflineCSS;
  const dialog = document.createElement('dialog'); dialog.id = 'cdl-offline-dialog';
  dialog.setAttribute('aria-labelledby', 'cdl-export-title');
  dialog.innerHTML = `
    <header><span class="brand"><img id="cdl-export-logo" width="32" height="32" alt=""><span>Canvas Downloader</span></span><button type="button" id="cdl-export-close" aria-label="Close course export">×</button></header>
    <h2 id="cdl-export-title">Exporting course</h2>
    <p id="cdl-export-course"></p>
    <div class="status-panel"><p id="cdl-export-status" role="status" aria-live="polite">Finding course materials…</p>
    <p id="cdl-export-detail" hidden></p>
    <progress id="cdl-export-progress" aria-label="Course export progress"></progress>
    </div>
    <p id="cdl-export-summary" hidden></p>
    <p id="cdl-export-note" class="note">You can close this window while it runs. Stay on this Canvas page.</p>
    <footer><button type="button" id="cdl-export-retry" hidden>Try again</button><button type="button" id="cdl-export-cancel">Cancel export</button><button type="button" id="cdl-export-done" class="primary" hidden>Done</button></footer>
  `;
  dialog.querySelector('#cdl-export-logo').src = typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL('assets/icons/icon48.png') : '/assets/icons/icon48.png';
  dialog.cdlHost = host; shadow.append(style, dialog);
  return dialog;
};

window.CanvasDownloaderUI.renderCourseList = function (model, onChange, onDownload, expanded) {
  const list = document.getElementById('cdl-file-list');
  const scroll = list.scrollTop;
  list.replaceChildren();
  const total = window.CanvasDownloader.uniqueFiles(model.groups.flatMap(group => group.files)).length;
  document.getElementById('cdl-file-count').textContent = `(${total} Files)`;
  document.getElementById('cdl-toolbar').style.display = 'inline-flex';
  for (const group of model.groups) {
    const details = document.createElement('details');
    details.className = 'cdl-module';
    details.open = expanded.has(group.id);
    details.addEventListener('toggle', () => {
      if (!details.isConnected) return;
      if (details.open) expanded.add(group.id); else expanded.delete(group.id);
    });
    const summary = document.createElement('summary');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.setAttribute('aria-label', `Select module ${group.name}`);
    const selected = model.selected.get(group.id) || new Set();
    checkbox.checked = group.files.length > 0 && selected.size === group.files.length;
    checkbox.indeterminate = selected.size > 0 && selected.size < group.files.length;
    checkbox.disabled = !group.scanning && group.files.length === 0;
    checkbox.addEventListener('click', event => event.stopPropagation());
    checkbox.addEventListener('change', () => { model.toggleModule(group.id, checkbox.checked); onChange(); });
    const name = document.createElement('span');
    name.className = 'cdl-module-name';
    name.textContent = group.name;
    const count = document.createElement('span');
    count.className = 'cdl-module-count';
    count.textContent = group.scanning ? 'Scanning…' : `${group.files.length} file${group.files.length === 1 ? '' : 's'}`;
    summary.append(checkbox, name, count);
    const body = document.createElement('div');
    const hrefs = new Set(group.files.filter(file => selected.has(window.CanvasDownloader.getResourceKey(file.href))).map(file => file.href));
    window.CanvasDownloaderUI.renderFileList(group.files, onDownload, hrefs, (href, checked) => {
      model.toggleFile(group.id, href, checked);
      onChange();
    }, { container: body });
    if (!group.files.length) body.textContent = group.scanning ? 'Looking for files…' : 'No downloadable files in this module.';
    details.append(summary, body);
    list.appendChild(details);
  }
  list.scrollTop = scroll;
};

window.CanvasDownloaderUI.getSafeDisplayName = function (text, extension = ".pdf") {
  if (!text) return "download" + extension;
  let clean = text.replace(/[<>:"/\\|?*]/g, '_');
  clean = clean.replace(/[\x00-\x1F\x7F\u00A0]/g, '_');
  clean = clean.trim().replace(/\.+$/, '');
  if (clean.length > 120) clean = clean.substring(0, 120).trim();
  // Don't append extension if it's empty or 'file' (unknown type)
  if (extension && extension !== 'file') {
    const ext = extension.startsWith('.') ? extension : `.${extension}`;
    if (!clean.toLowerCase().endsWith(ext.toLowerCase())) clean += ext;
  }
  if (clean.length === 0 || clean === extension) return "download" + extension;
  return clean;
};

window.CanvasDownloaderUI.createToolbar = function (iconUrl) {
  const toolbar = document.createElement('div');
  toolbar.id = 'cdl-toolbar';
  toolbar.className = 'cdl-toolbar';
  toolbar.style.display = 'none'; // Start hidden; shown when files found or scanning begins

  toolbar.innerHTML = `
      <div class="cdl-toolbar-inner">
        <div class="cdl-button-group" id="cdl-button-group">
          <button type="button" id="cdl-main-btn" class="cdl-main-btn" title="Download all files found on this page">
            <div class="cdl-btn-content" id="cdl-main-text">
              <span class="cdl-main-title">Download All</span>
              <span id="cdl-file-count" class="cdl-file-count-badge">(0 Files)</span>
              <span id="cdl-scan-status" class="cdl-scan-status" style="display:none;">
                <span class="cdl-scan-dot"></span>
                <span id="cdl-scan-text">Scanning...</span>
              </span>
            </div>
            
            <div class="cdl-loading-bar-container">
              <div class="cdl-loading-bar-fill" id="cdl-loading-bar"></div>
            </div>

            <div class="cdl-success-state" id="cdl-success-state">
              <span>Downloaded!</span>
              <svg class="cdl-success-icon" viewBox="0 0 16 16" fill="currentColor">
                <path fill-rule="evenodd" d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"/>
              </svg>
            </div>
          </button>
          <button type="button" id="cdl-toggle-btn" class="cdl-toggle-btn" title="View individual files">
            <svg class="cdl-chevron" id="cdl-chevron" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
            </svg>
          </button>
        </div>
      </div>
      <div id="cdl-dropdown" class="cdl-dropdown">
        <div class="cdl-dropdown-info">
          <div class="cdl-info-brand">
            <img src="${iconUrl}" alt="Logo" class="cdl-info-logo" />
            <span class="cdl-info-title">Canvas Downloader</span>
          </div>
          <div class="cdl-info-actions">
            <span class="cdl-info-subtitle">Individual Files</span>
            <button type="button" id="cdl-rescan-btn" class="cdl-rescan-btn" title="Re-scan course for new files">
              <svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="cdl-dropdown-header">
          <button type="button" id="cdl-download-all-btn" class="cdl-download-all-btn" style="display:none;">
            <svg class="cdl-icon-sm" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
              <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
            </svg>
            <span id="cdl-download-all-text">Download All</span>
          </button>

          <span id="cdl-progress-text" class="cdl-progress-text" style="display:none;"></span>
        </div>
        <div class="cdl-select-all-row" id="cdl-select-all-row">
          <label class="cdl-select-all-label">
            <input type="checkbox" id="cdl-select-all-checkbox" checked>
            <span id="cdl-select-all-text">Select All</span>
          </label>
          <label class="cdl-zip-toggle" id="cdl-zip-toggle" title="Download the selected files as one ZIP archive">
            <input type="checkbox" id="cdl-zip-toggle-input">
            <span>ZIP archive</span>
          </label>
        </div>
        <div id="cdl-course-nav" class="cdl-course-nav" hidden>
          <button type="button" id="cdl-browse-course">Browse course modules</button>
          <button type="button" id="cdl-back-page" hidden>Back to this page</button>
        </div>
        <div id="cdl-run-summary" class="cdl-run-summary" role="status" hidden></div>
        <button type="button" id="cdl-retry-failed" class="cdl-retry-failed" hidden>Retry failed files</button>
        <div id="cdl-file-list" class="cdl-file-list">
          <!-- Files rendered here -->
        </div>
        </div>
      </div>
    `;

  return toolbar;
};

window.CanvasDownloaderUI.renderFileList = function (currentFiles, onDownloadClick, selectedHrefs, onToggleSelect, options = {}) {
  const fileList = options.container || document.getElementById('cdl-file-list');
  const countBadge = document.getElementById('cdl-file-count');

  if (!fileList || !countBadge) return;

  // Default to "everything selected" so callers that don't pass a selection
  // (or older call sites) keep the original "download everything" behavior.
  if (!selectedHrefs) {
    selectedHrefs = new Set(currentFiles.map(f => f.href));
  }

  const count = currentFiles.length;

  // Update badge text
  if (!options.container) countBadge.textContent = `(${count} File${count === 1 ? '' : 's'})`;

  // Handle visibility — keep visible during deep scan even if no files yet
  const toolbar = document.getElementById('cdl-toolbar');
  const scanStatus = document.getElementById('cdl-scan-status');
  const isScanning = scanStatus && scanStatus.style.display !== 'none';
  if (toolbar && !options.container) {
    toolbar.style.display = (count > 0 || isScanning || window.CanvasDownloader?.extractCourseId()) ? 'inline-flex' : 'none';
  }

  fileList.innerHTML = '';
  if (count === 0) {
    fileList.innerHTML = '<div class="cdl-empty">No downloadable files found on this page.</div>';
    return;
  }

  currentFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'cdl-file-item';
    item.setAttribute('data-href', file.href);

    // Prefer resolvedType (from Canvas API) over original type
    const effectiveType = file.resolvedType || file.type || 'file';
    const ext = effectiveType.replace('.', '').toUpperCase();
    // Don't append '.file' to display names — pass empty ext for unknown types
    const displayExt = (effectiveType === 'file') ? '' : effectiveType;
    const displayName = window.CanvasDownloaderUI.getSafeDisplayName(file.resolvedName || file.text, displayExt);
    const extClass = `cdl-badge-${ext.toLowerCase()}`;

    item.innerHTML = `
    <input type="checkbox" class="cdl-file-checkbox" data-href="${file.href}" ${selectedHrefs.has(file.href) ? 'checked' : ''}>
    <div class="cdl-file-info">
      <span class="cdl-file-badge ${extClass}">${ext}</span>
      <span class="cdl-file-name" title="${file.text}">${displayName}</span>
    </div>
    <button type="button" class="cdl-file-download-btn" data-index="${index}" title="Download this file">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
        <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
        <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
      </svg>
    </button>
  `;

    // Selection checkbox
    item.querySelector('.cdl-file-checkbox').addEventListener('change', (e) => {
      e.stopPropagation();
      if (onToggleSelect) onToggleSelect(file.href, e.target.checked);
    });
    item.querySelector('.cdl-file-checkbox').setAttribute('aria-label', `Select ${displayName}`);
    item.querySelector('.cdl-file-checkbox').addEventListener('click', (e) => e.stopPropagation());

    // Individual download button
    item.querySelector('.cdl-file-download-btn').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (onDownloadClick) onDownloadClick(file, item);
    });

    fileList.appendChild(item);
  });
};
