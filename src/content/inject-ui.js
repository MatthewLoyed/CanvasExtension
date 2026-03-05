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

    function injectToolbar() {
        const iconUrl = chrome.runtime.getURL('assets/icons/icon32.png');
        const toolbar = window.CanvasDownloaderUI.createToolbar(iconUrl);

        // Use the breadcrumbs as the primary anchor. This is the most consistent 
        // element across all Canvas pages (Syllabus, Modules, Assignments, etc.)
        const collapseAllBtn = document.getElementById('expand_collapse_all') || document.querySelector('.collapse_all_buttons') || document.querySelector('button[title="Collapse All"]');
        const headerBarRight = document.querySelector('.header-bar-right');
        const breadcrumbs = document.getElementById('breadcrumbs');
        const headerBar = document.querySelector('.ic-app-nav-toggle-and-main-content');
        const contentArea = document.getElementById('content');

        if (collapseAllBtn && collapseAllBtn.parentNode) {
            collapseAllBtn.parentNode.insertBefore(toolbar, collapseAllBtn);
        } else if (headerBarRight) {
            headerBarRight.insertBefore(toolbar, headerBarRight.firstChild);
        } else if (breadcrumbs && breadcrumbs.parentNode) {
            breadcrumbs.parentNode.insertBefore(toolbar, breadcrumbs.nextSibling);
        } else if (contentArea) {
            contentArea.insertBefore(toolbar, contentArea.firstChild);
        } else if (headerBar) {
            headerBar.insertBefore(toolbar, headerBar.firstChild);
        }

        // Bind events
        bindEvents();
    }

    // ============================================================
    // Event Binding
    // ============================================================
    function bindEvents() {
        const mainBtn = document.getElementById('cdl-main-btn');
        const toggleBtn = document.getElementById('cdl-toggle-btn');
        const downloadAllBtn = document.getElementById('cdl-download-all-btn');
        const dropdown = document.getElementById('cdl-dropdown');

        // Main button: Instantly download all
        mainBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currentFiles.length === 0 || isDownloading) return;
            downloadAll();
            // Optional: close dropdown if it was open
            isDropdownOpen = false;
            dropdown.classList.remove('cdl-dropdown-open');
            document.getElementById('cdl-chevron').classList.remove('cdl-chevron-open');
        });

        // Toggle button: View file list
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            isDropdownOpen = !isDropdownOpen;
            dropdown.classList.toggle('cdl-dropdown-open', isDropdownOpen);
            document.getElementById('cdl-chevron').classList.toggle('cdl-chevron-open', isDropdownOpen);
        });

        // Hidden "Download All" inside dropdown (optional backup)
        downloadAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currentFiles.length === 0 || isDownloading) return;
            downloadAll();
        });

        // Re-scan Button: Trigger a manual deep scan
        const rescanBtn = document.getElementById('cdl-rescan-btn');
        if (rescanBtn) {
            rescanBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Send event to content.js to bypass cache and rescan
                document.dispatchEvent(new CustomEvent('cdl-trigger-rescan'));
            });
        }

        // Feedback Modal Logic
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const toolbar = document.getElementById('cdl-toolbar');

            if (toolbar && !toolbar.contains(e.target) && isDropdownOpen) {
                isDropdownOpen = false;
                dropdown.classList.remove('cdl-dropdown-open');
                document.getElementById('cdl-chevron').classList.remove('cdl-chevron-open');
            }
        });
    }

    // ============================================================
    // Inline Button Injection
    // ============================================================
    function injectInlineButtons() {
        const links = document.querySelectorAll('a[data-cdl-link="true"]');
        const courseName = getCourseNameFromPage();

        links.forEach(link => {
            // Avoid double-injection
            if (link.nextElementSibling && link.nextElementSibling.classList.contains('cdl-inline-btn-container')) return;

            const href = link.getAttribute('data-cdl-href');
            const text = link.getAttribute('data-cdl-text');
            const type = link.getAttribute('data-cdl-type');

            const container = document.createElement('span');
            container.className = 'cdl-inline-btn-container';
            container.innerHTML = `
        <button class="cdl-inline-btn" title="Download this file with Canvas Downloader">
          <svg viewBox="0 0 16 16" fill="currentColor">
            <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
            <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
          </svg>
          <div class="cdl-inline-spinner"></div>
          <svg class="cdl-inline-success-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
          </svg>
        </button>
      `;

            container.querySelector('.cdl-inline-btn').addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const btn = e.currentTarget;
                if (btn.classList.contains('is-loading')) return;

                btn.classList.add('is-loading');

                const file = { href, text, type, courseName };
                sendToContentScript({
                    action: 'resolve_and_download',
                    file: file
                }, (response) => {
                    if (!response || !response.success) {
                        btn.classList.remove('is-loading');
                        btn.classList.add('is-error');
                        setTimeout(() => btn.classList.remove('is-error'), 2000);
                    }
                    // Status will be updated via chrome.runtime.onMessage if we implement mapping
                });
            });

            // Insert after the link
            link.insertAdjacentElement('afterend', container);
        });
    }

    function getCourseNameFromPage() {
        const crumbs = document.querySelectorAll('#breadcrumbs ul li');
        if (crumbs && crumbs.length >= 2) {
            return crumbs[1].innerText.trim();
        }
        return "General";
    }

    // ============================================================
    // Download Actions
    // ============================================================
    function downloadAll() {
        if (currentFiles.length === 0) return;

        isDownloading = true;
        const btnGroup = document.getElementById('cdl-button-group');
        const progressBar = document.getElementById('cdl-loading-bar');

        // Enter loading state
        btnGroup.classList.add('is-loading');
        progressBar.style.width = '0%';

        // Mark all file items as queued
        document.querySelectorAll('.cdl-file-item').forEach(item => {
            setFileItemStatus(item, 'queued');
        });

        // Send batch to content.js for URL resolution → then service worker for download
        sendToContentScript({
            action: 'resolve_and_download_batch',
            files: currentFiles
        }, (response) => {
            if (response && response.success) {
                // Initial progress update
                progressBar.style.width = '5%';
            } else {
                isDownloading = false;
                btnGroup.classList.remove('is-loading');
                alert('Could not start batch download.');
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

            // Also update inline buttons
            const inlineBtn = document.querySelector(`a[data-cdl-href="${CSS.escape(msg.href)}"]`)?.nextElementSibling?.querySelector('.cdl-inline-btn');
            if (inlineBtn) {
                inlineBtn.classList.remove('is-loading', 'is-success', 'is-error');
                if (msg.status === 'loading' || msg.status === 'queued') {
                    inlineBtn.classList.add('is-loading');
                } else if (msg.status === 'success') {
                    inlineBtn.classList.add('is-success');
                    setTimeout(() => inlineBtn.classList.remove('is-success'), 3000);
                } else if (msg.status === 'error') {
                    inlineBtn.classList.add('is-error');
                    setTimeout(() => inlineBtn.classList.remove('is-error'), 3000);
                }
            }
        }

        // Overall progress update
        if (msg.action === 'download_progress') {
            if (!isDownloading) return; // Only process if toolbar-initiated download is active

            const btnGroup = document.getElementById('cdl-button-group');
            const progressBar = document.getElementById('cdl-loading-bar');
            const countBadge = document.getElementById('cdl-file-count');

            if (btnGroup && progressBar) {
                if (msg.done) {
                    progressBar.style.width = '100%';
                    btnGroup.classList.remove('is-loading');
                    btnGroup.classList.add('is-success');
                    isDownloading = false;

                    // Reset after viewing success state for 3 seconds
                    setTimeout(() => {
                        btnGroup.classList.remove('is-success');
                        progressBar.style.width = '0%';
                        if (countBadge) countBadge.textContent = `(${currentFiles.length} File${currentFiles.length === 1 ? '' : 's'})`;
                    }, 3000);
                } else {
                    const percent = Math.round((msg.completed / msg.total) * 100);
                    progressBar.style.width = `${Math.max(5, percent)}%`;
                    if (countBadge) countBadge.textContent = `(${msg.completed}/${msg.total})`;
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
            window.CanvasDownloaderUI.renderFileList(currentFiles, downloadSingle);
            // Inject inline buttons whenever file data is ready/updated
            injectInlineButtons();
        }
    });

    // ============================================================
    // Listen for Deep Scan Status from content.js
    // ============================================================
    document.addEventListener('cdl-deep-scan-status', (e) => {
        const scanStatus = document.getElementById('cdl-scan-status');
        const scanText = document.getElementById('cdl-scan-text');
        if (!scanStatus || !scanText) return;

        const detail = e.detail || {};

        if (detail.status === 'scanning') {
            scanStatus.style.display = 'inline-flex';
            // Ensure toolbar is visible and animated during scanning
            const toolbar = document.getElementById('cdl-toolbar');
            if (toolbar && toolbar.style.display === 'none') {
                toolbar.style.display = 'inline-flex';
                // Re-trigger entrance animation
                toolbar.style.animation = 'none';
                toolbar.offsetHeight; // Force reflow
                toolbar.style.animation = '';
            }
            if (detail.total > 0) {
                scanText.textContent = `Scanning ${detail.current}/${detail.total}...`;
            } else {
                scanText.textContent = 'Scanning...';
            }

            const rescanBtn = document.getElementById('cdl-rescan-btn');
            if (rescanBtn) rescanBtn.classList.add('is-spinning');
        } else {
            scanStatus.style.display = 'none';
            const rescanBtn = document.getElementById('cdl-rescan-btn');
            if (rescanBtn) rescanBtn.classList.remove('is-spinning');
            // Re-render file list to re-evaluate toolbar visibility
            // (hides toolbar if scan completed with 0 files)
            window.CanvasDownloaderUI.renderFileList(currentFiles, downloadSingle);
        }
    });

    // ============================================================
    // Initialize
    // ============================================================
    function init() {
        // Short delay to let DOM settle
        setTimeout(() => {
            injectToolbar();
            injectInlineButtons();

            // Request current file data from content.js in case we loaded after it
            sendToContentScript({ action: 'get_files' }, (response) => {
                if (response && response.files && response.isCanvas) {
                    currentFiles = response.files;
                    window.CanvasDownloaderUI.renderFileList(currentFiles, downloadSingle);
                    injectInlineButtons();
                }
            });
        }, 500);

        // Periodically check for new links that might have been rendered
        setInterval(injectInlineButtons, 2000);
    }

    init();
})();
