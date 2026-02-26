/**
 * inject-ui.js
 * 
 * Injects a Download button + collapsible file panel directly into Canvas pages.
 * Communicates with content.js (for file data + URL resolution) and 
 * service-worker.js (for downloads + side panel).
 * 
 * Only activates on Canvas LMS pages.
 */

(function () {
    'use strict';

    // Prevent double-injection
    if (document.getElementById('cdl-toolbar')) return;

    // ============================================================
    // Canvas Detection (same logic as content.js)
    // ============================================================
    function isCanvasPage() {
        const hasCanvasApp = !!document.getElementById('application');
        const hasCanvasNav = !!document.querySelector('.ic-app-nav-toggle-and-main-content');
        const hasBreadcrumbs = !!document.getElementById('breadcrumbs');
        const hasEnv = typeof window.ENV !== 'undefined';
        const signals = [hasCanvasApp, hasCanvasNav, hasBreadcrumbs, hasEnv];
        return signals.filter(Boolean).length >= 2;
    }

    // Guard: exit immediately on non-Canvas pages
    if (!isCanvasPage()) return;

    // ============================================================
    // State
    // ============================================================
    let currentFiles = [];
    let isDropdownOpen = false;
    let isDownloading = false;

    // ============================================================
    // Build the UI
    // ============================================================
    function createToolbar() {
        const toolbar = document.createElement('div');
        toolbar.id = 'cdl-toolbar';
        toolbar.className = 'cdl-toolbar';

        toolbar.innerHTML = `
      <div class="cdl-toolbar-inner">
        <button id="cdl-download-btn" class="cdl-download-btn" title="Download files from this page">
          <svg class="cdl-icon" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
            <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
          </svg>
          <span id="cdl-btn-text">Download</span>
          <span id="cdl-badge" class="cdl-badge" style="display:none;">0</span>
          <svg class="cdl-chevron" id="cdl-chevron" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
          </svg>
        </button>
      </div>
      <div id="cdl-dropdown" class="cdl-dropdown" style="display:none;">
        <div class="cdl-dropdown-header">
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
        <div class="cdl-dropdown-footer">
          <button id="cdl-open-panel-btn" class="cdl-open-panel-btn" title="Open full side panel for search & filters">
            <svg class="cdl-icon-sm" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h12zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z"/>
              <path d="M11 2a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9.5a.5.5 0 0 1 0-1H11V3H9.5a.5.5 0 0 1 0-1H11z"/>
            </svg>
            <span style="display:inline-block; margin-top:2px;">Open Full Panel</span>
          </button>
        </div>
      </div>
    `;

        return toolbar;
    }

    function injectToolbar() {
        const toolbar = createToolbar();

        // Use the breadcrumbs as the primary anchor. This is the most consistent 
        // element across all Canvas pages (Syllabus, Modules, Assignments, etc.)
        const breadcrumbs = document.getElementById('breadcrumbs');
        const headerBar = document.querySelector('.ic-app-nav-toggle-and-main-content');
        const contentArea = document.getElementById('content');

        if (breadcrumbs && breadcrumbs.parentNode) {
            breadcrumbs.parentNode.insertBefore(toolbar, breadcrumbs.nextSibling);
        } else if (contentArea) {
            contentArea.insertBefore(toolbar, contentArea.firstChild);
        } else if (headerBar) {
            headerBar.insertBefore(toolbar, headerBar.firstChild);
        } else {
            document.body.insertBefore(toolbar, document.body.firstChild);
        }

        // Bind events
        bindEvents();
    }

    // ============================================================
    // Event Binding
    // ============================================================
    function bindEvents() {
        const downloadBtn = document.getElementById('cdl-download-btn');
        const downloadAllBtn = document.getElementById('cdl-download-all-btn');
        const openPanelBtn = document.getElementById('cdl-open-panel-btn');
        const dropdown = document.getElementById('cdl-dropdown');

        // Toggle dropdown
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            isDropdownOpen = !isDropdownOpen;
            dropdown.style.display = isDropdownOpen ? 'block' : 'none';
            document.getElementById('cdl-chevron').classList.toggle('cdl-chevron-open', isDropdownOpen);
        });

        // Download All
        downloadAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currentFiles.length === 0 || isDownloading) return;
            downloadAll();
        });

        // Open side panel
        openPanelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            chrome.runtime.sendMessage({ action: 'open_sidepanel' });
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const toolbar = document.getElementById('cdl-toolbar');
            if (toolbar && !toolbar.contains(e.target) && isDropdownOpen) {
                isDropdownOpen = false;
                dropdown.style.display = 'none';
                document.getElementById('cdl-chevron').classList.remove('cdl-chevron-open');
            }
        });
    }

    // ============================================================
    // File List Rendering
    // ============================================================
    function renderFileList() {
        const fileList = document.getElementById('cdl-file-list');
        const badge = document.getElementById('cdl-badge');
        const downloadAllText = document.getElementById('cdl-download-all-text');

        if (!fileList) return;

        const count = currentFiles.length;

        // Update badge
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }

        // Update download all text
        downloadAllText.textContent = `Download All (${count} files)`;

        // Hide toolbar entirely if no files
        const toolbar = document.getElementById('cdl-toolbar');
        if (toolbar) {
            toolbar.style.display = count > 0 ? 'block' : 'none';
        }

        // Render file items
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
            const displayName = file.text || 'Unnamed File';

            item.innerHTML = `
        <div class="cdl-file-info">
          <span class="cdl-file-badge">${ext}</span>
          <span class="cdl-file-name" title="${displayName}">${displayName}</span>
        </div>
        <button class="cdl-file-download-btn" data-index="${index}" title="Download this file">
          <svg class="cdl-icon-sm" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
            <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
          </svg>
        </button>
      `;

            // Individual download button
            item.querySelector('.cdl-file-download-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                downloadSingle(file, item);
            });

            fileList.appendChild(item);
        });
    }

    // ============================================================
    // Download Actions
    // ============================================================
    function downloadAll() {
        if (currentFiles.length === 0) return;

        isDownloading = true;
        const downloadAllBtn = document.getElementById('cdl-download-all-btn');
        const downloadAllText = document.getElementById('cdl-download-all-text');
        const progressText = document.getElementById('cdl-progress-text');

        downloadAllBtn.disabled = true;
        downloadAllText.textContent = 'Resolving URLs...';

        // Mark all file items as queued
        document.querySelectorAll('.cdl-file-item').forEach(item => {
            setFileItemStatus(item, 'queued');
        });

        // Send batch to content.js for URL resolution → then service worker for download
        // Use chrome.runtime.sendMessage which routes to content script via the tab
        sendToContentScript({
            action: 'resolve_and_download_batch',
            files: currentFiles
        }, (response) => {
            if (response && response.success) {
                downloadAllText.textContent = `Downloading...`;
                progressText.style.display = 'inline';
                progressText.textContent = `(0/${currentFiles.length})`;
            } else {
                downloadAllText.textContent = 'Download All';
                downloadAllBtn.disabled = false;
                isDownloading = false;
            }
        });
    }

    function downloadSingle(file, itemElement) {
        setFileItemStatus(itemElement, 'loading');

        sendToContentScript({
            action: 'resolve_and_download',
            file: file
        }, (response) => {
            if (!response || !response.success) {
                setFileItemStatus(itemElement, 'error');
            }
            // Status will be updated by download_file_status message listener
        });
    }

    /**
     * Send a message to the content script in the current tab.
     * Since inject-ui.js IS a content script, we can't use chrome.tabs.sendMessage.
     * Instead, we dispatch a CustomEvent that content.js listens for,
     * OR we use chrome.runtime to relay through the service worker.
     * 
     * Simplest approach: use chrome.runtime.sendMessage to reach the service worker,
     * which forwards to the tab. But content.js also listens on chrome.runtime.onMessage.
     * Since both are in the same tab, chrome.runtime.sendMessage actually works for
     * messages handled by chrome.runtime.onMessage in content.js.
     * 
     * Wait — that's not right. chrome.runtime.sendMessage goes to the SERVICE WORKER,
     * not to other content scripts. Content scripts receive messages from chrome.tabs.sendMessage.
     * 
     * The correct approach for inject-ui.js (content script) to talk to content.js (content script
     * in the same tab): use DOM CustomEvents or window.postMessage.
     */
    function sendToContentScript(message, callback) {
        // We use a CustomEvent on the document to communicate between content scripts
        const responseId = 'cdl-response-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

        const handler = (e) => {
            if (e.detail && e.detail.responseId === responseId) {
                document.removeEventListener('cdl-response', handler);
                if (callback) callback(e.detail.response);
            }
        };
        document.addEventListener('cdl-response', handler);

        document.dispatchEvent(new CustomEvent('cdl-request', {
            detail: { ...message, responseId: responseId }
        }));

        // Timeout fallback
        setTimeout(() => {
            document.removeEventListener('cdl-response', handler);
        }, 30000);
    }

    // ============================================================
    // File Item Status Updates
    // ============================================================
    function setFileItemStatus(itemElement, status) {
        if (!itemElement) return;
        const btn = itemElement.querySelector('.cdl-file-download-btn');
        if (!btn) return;

        itemElement.classList.remove('cdl-status-queued', 'cdl-status-loading', 'cdl-status-success', 'cdl-status-error');

        if (status === 'queued') {
            itemElement.classList.add('cdl-status-queued');
            btn.innerHTML = '<span class="cdl-queued-text">QUEUED</span>';
        } else if (status === 'loading') {
            itemElement.classList.add('cdl-status-loading');
            btn.innerHTML = '<div class="cdl-spinner"></div>';
        } else if (status === 'success') {
            itemElement.classList.add('cdl-status-success');
            btn.innerHTML = `<svg class="cdl-icon-sm" viewBox="0 0 16 16" fill="currentColor"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/></svg>`;
        } else if (status === 'error') {
            itemElement.classList.add('cdl-status-error');
            btn.innerHTML = '❌';
        }
    }

    // ============================================================
    // Listen for Progress Updates from Service Worker
    // ============================================================
    chrome.runtime.onMessage.addListener((msg) => {
        // Per-file status update
        if (msg.action === 'download_file_status') {
            const item = document.querySelector(`.cdl-file-item[data-href="${CSS.escape(msg.href)}"]`);
            if (item) {
                setFileItemStatus(item, msg.status);
            }
        }

        // Overall progress update
        if (msg.action === 'download_progress') {
            const downloadAllText = document.getElementById('cdl-download-all-text');
            const progressText = document.getElementById('cdl-progress-text');
            const downloadAllBtn = document.getElementById('cdl-download-all-btn');

            if (downloadAllText && progressText) {
                if (msg.done) {
                    downloadAllText.textContent = '✓ Complete!';
                    progressText.style.display = 'none';
                    if (downloadAllBtn) downloadAllBtn.disabled = false;
                    isDownloading = false;

                    // Reset after delay
                    setTimeout(() => {
                        downloadAllText.textContent = `Download All (${currentFiles.length} files)`;
                    }, 4000);
                } else {
                    downloadAllText.textContent = 'Downloading...';
                    progressText.style.display = 'inline';
                    progressText.textContent = `(${msg.completed}/${msg.total})`;
                }
            }
        }
    });

    // ============================================================
    // Listen for File Data from content.js
    // ============================================================
    document.addEventListener('cdl-files-ready', (e) => {
        if (e.detail && e.detail.files) {
            currentFiles = e.detail.files;
            renderFileList();
        }
    });

    // ============================================================
    // Initialize
    // ============================================================
    function init() {
        // Wait a bit for content.js to finish its initial scrape
        setTimeout(() => {
            injectToolbar();

            // Request current file data from content.js in case we loaded after it
            sendToContentScript({ action: 'get_files' }, (response) => {
                if (response && response.files && response.isCanvas) {
                    currentFiles = response.files;
                    renderFileList();
                }
            });
        }, 500);
    }

    init();
})();
