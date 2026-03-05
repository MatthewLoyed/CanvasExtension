/**
 * ui-builder.js
 * Extracted DOM creation logic for Canvas Downloader Extension
 */

window.CanvasDownloaderUI = window.CanvasDownloaderUI || {};

window.CanvasDownloaderUI.getSafeDisplayName = function (text, extension = ".pdf") {
  if (!text) return "download" + extension;
  let clean = text.replace(/[<>:"/\\|?*]/g, '_');
  clean = clean.replace(/[\x00-\x1F\x7F\u00A0]/g, '_');
  clean = clean.trim().replace(/\.+$/, '');
  if (clean.length > 120) clean = clean.substring(0, 120).trim();
  if (extension) {
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
          <button id="cdl-main-btn" class="cdl-main-btn" title="Download all files found on this page">
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
          <button id="cdl-toggle-btn" class="cdl-toggle-btn" title="View individual files">
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
            <button id="cdl-rescan-btn" class="cdl-rescan-btn" title="Re-scan course for new files">
              <svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="cdl-dropdown-header" style="display:none;">
          <button id="cdl-download-all-btn" class="cdl-download-all-btn">
            <svg class="cdl-icon-sm" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
              <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
            </svg>
            <span id="cdl-download-all-text">Download All</span>
          </button>
          <span id="cdl-progress-text" class="cdl-progress-text" style="display:none;"></span>
        </div>
        <div id="cdl-file-list" class="cdl-file-list">
          <!-- Files rendered here -->
        </div>
        </div>
      </div>
    `;

  return toolbar;
};

window.CanvasDownloaderUI.renderFileList = function (currentFiles, onDownloadClick) {
  const fileList = document.getElementById('cdl-file-list');
  const countBadge = document.getElementById('cdl-file-count');

  if (!fileList || !countBadge) return;

  const count = currentFiles.length;

  // Update badge text
  countBadge.textContent = `(${count} File${count === 1 ? '' : 's'})`;

  // Handle visibility — keep visible during deep scan even if no files yet
  const toolbar = document.getElementById('cdl-toolbar');
  const scanStatus = document.getElementById('cdl-scan-status');
  const isScanning = scanStatus && scanStatus.style.display !== 'none';
  if (toolbar) {
    toolbar.style.display = (count > 0 || isScanning) ? 'inline-flex' : 'none';
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

    const ext = (file.type || 'file').replace('.', '').toUpperCase();
    const displayName = window.CanvasDownloaderUI.getSafeDisplayName(file.text, file.type);
    const extClass = `cdl-badge-${ext.toLowerCase()}`;

    item.innerHTML = `
    <div class="cdl-file-info">
      <span class="cdl-file-badge ${extClass}">${ext}</span>
      <span class="cdl-file-name" title="${file.text}">${displayName}</span>
    </div>
    <button class="cdl-file-download-btn" data-index="${index}" title="Download this file">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
        <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
        <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
      </svg>
    </button>
  `;

    // Individual download button
    item.querySelector('.cdl-file-download-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (onDownloadClick) onDownloadClick(file, item);
    });

    fileList.appendChild(item);
  });
};
