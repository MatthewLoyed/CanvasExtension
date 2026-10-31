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
    let selectedHrefs = new Set();
    let zipEnabled = false;
    const pendingSingles = new Set();
    const courseSelection = window.CanvasDownloader.CourseSelection ? new window.CanvasDownloader.CourseSelection() : null;
    let courseMode = !!window.CanvasDownloader.isModuleListPage?.();
    let courseState = { groups: [], scanning: false, complete: false, error: '' };
    const expandedModules = new Set();
    let activeRunId = null;
    let runFiles = [];
    let runZip = false;
    const failedFiles = new Set();
    const fileStatuses = new Map();

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
        } else if (contentArea) {
            contentArea.insertBefore(toolbar, contentArea.firstChild);
        } else if (headerBarRight) {
            headerBarRight.insertBefore(toolbar, headerBarRight.firstChild);
        } else if (breadcrumbs && breadcrumbs.parentNode) {
            breadcrumbs.parentNode.insertBefore(toolbar, breadcrumbs.nextSibling);
        } else if (headerBar) {
            headerBar.insertBefore(toolbar, headerBar.firstChild);
        }

        // Bind events
        bindEvents();
        const nav = document.getElementById('cdl-course-nav');
        nav.hidden = !window.CanvasDownloader.extractCourseId() || !!window.CanvasDownloader.isModuleListPage?.();
        document.getElementById('cdl-browse-course').addEventListener('click', () => {
            courseMode = true;
            startCourseScan();
        });
        document.getElementById('cdl-back-page').addEventListener('click', () => { courseMode = false; renderFiles(); });
        document.getElementById('cdl-retry-failed').addEventListener('click', () => {
            const retry = runFiles.filter(file => failedFiles.has(window.CanvasDownloader.getResourceKey(file.href)));
            if (!isDownloading && retry.length) downloadSelected(retry, runZip);
        });
    }

    // ============================================================
    // Event Binding
    // ============================================================
    function bindEvents() {
        const mainBtn = document.getElementById('cdl-main-btn');
        const toggleBtn = document.getElementById('cdl-toggle-btn');
        const downloadAllBtn = document.getElementById('cdl-download-all-btn');
        const dropdown = document.getElementById('cdl-dropdown');
        const selectAllCheckbox = document.getElementById('cdl-select-all-checkbox');
        const zipToggleInput = document.getElementById('cdl-zip-toggle-input');

        // Main button: Instantly download the current selection
        mainBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if ((courseMode && courseSelection ? courseSelection.files().length : currentFiles.length) === 0 || isDownloading) return;
            downloadSelected();
            // Optional: close dropdown if it was open
            isDropdownOpen = false;
            dropdown.classList.remove('cdl-dropdown-open');
            document.getElementById('cdl-chevron').classList.remove('cdl-chevron-open');
        });

        // Toggle button: View file list
        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            isDropdownOpen = !isDropdownOpen;
            dropdown.classList.toggle('cdl-dropdown-open', isDropdownOpen);
            document.getElementById('cdl-chevron').classList.toggle('cdl-chevron-open', isDropdownOpen);
        });

        // Hidden "Download Selected" inside dropdown (optional backup)
        downloadAllBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if ((courseMode && courseSelection ? courseSelection.files().length : currentFiles.length) === 0 || isDownloading) return;
            downloadSelected();
        });

        // Select all / none
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', (e) => {
                if (courseMode && courseSelection) { courseSelection.selectAll(e.target.checked); renderFiles(); return; }
                selectedHrefs = e.target.checked ? new Set(currentFiles.map(f => f.href)) : new Set();
                renderFiles();
            });
        }

        // Zip bundle toggle
        if (zipToggleInput) {
            zipToggleInput.addEventListener('change', (e) => {
                zipEnabled = e.target.checked;
            });
        }

        // Re-scan Button: Trigger a full rescan
        const rescanBtn = document.getElementById('cdl-rescan-btn');
        if (rescanBtn) {
            rescanBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Prevent clicking while a scan is already in progress
                if (rescanBtn.classList.contains('is-spinning')) return;
                if (courseMode) { startCourseScan(true); return; }
                // Immediately clear the file list in the UI so the user sees it reset
                currentFiles = [];
                selectedHrefs = new Set();
                renderFiles();
                // Send event to content.js to bypass cache and rescan everything
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
    const inlineControls = new WeakMap();
    function injectInlineButtons() {
        const links = document.querySelectorAll('a[data-cdl-link="true"]');
        const courseName = getCourseNameFromPage();

        links.forEach(link => {
            // Native Canvas controls must not receive extension controls of their own.
            if (link.matches('.file_download_btn, .file_download_link') ||
                (link.hasAttribute('download') && !link.textContent.trim())) return;
            // Canvas may insert preview controls between our button and its link.
            const owned = inlineControls.get(link);
            if (owned?.isConnected) return;
            if (link.nextElementSibling?.classList.contains('cdl-inline-btn-container')) {
                inlineControls.set(link, link.nextElementSibling);
                return;
            }

            const href = link.getAttribute('data-cdl-href');
            const text = link.getAttribute('data-cdl-text');
            const type = link.getAttribute('data-cdl-type');

            const container = document.createElement('span');
            container.className = 'cdl-inline-btn-container';
            container.innerHTML = `
        <button type="button" class="cdl-inline-btn" title="Download this file with Canvas Downloader">
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
                const key = window.CanvasDownloader.getResourceKey(href);
                if (pendingSingles.has(key)) return;
                pendingSingles.add(key);

                btn.classList.add('is-loading');

                const file = { href, text, type, courseName };
                sendToContentScript({
                    action: 'resolve_and_download',
                    file: file
                }, (response) => {
                    if (!response || !response.success) {
                        pendingSingles.delete(key);
                        btn.classList.remove('is-loading');
                        btn.classList.add('is-error');
                        setTimeout(() => btn.classList.remove('is-error'), 2000);
                    }
                    // Status will be updated via chrome.runtime.onMessage if we implement mapping
                });
            });

            // Insert after the link
            link.insertAdjacentElement('afterend', container);
            inlineControls.set(link, container);
        });
    }

    function getCourseNameFromPage() {
        return window.CanvasDownloader.getCourseName();
    }

    // ============================================================
    // Selection State
    // ============================================================

    // Re-render the file list with current selection state and refresh the
    // action button label. Central place any selection/list change goes through.
    function renderFiles() {
        if (courseMode && courseSelection) {
            window.CanvasDownloaderUI.renderCourseList(courseSelection, renderFiles, downloadSingle, expandedModules);
            const summary = document.getElementById('cdl-run-summary');
            if (!isDownloading) {
                summary.hidden = false;
                summary.textContent = courseState.error || (courseState.scanning ?
                    `Scanning modules ${courseState.completed || 0}/${courseState.total || '…'}…` :
                    `${courseSelection.files().length} unique files selected across modules`);
            }
        } else {
            window.CanvasDownloaderUI.renderFileList(currentFiles, downloadSingle, selectedHrefs, onToggleSelect);
            if (!isDownloading) document.getElementById('cdl-run-summary').hidden = true;
        }
        const subtitle = document.querySelector('.cdl-info-subtitle');
        if (subtitle) subtitle.textContent = courseMode ? 'Course modules' : 'Individual files';
        const back = document.getElementById('cdl-back-page');
        const browse = document.getElementById('cdl-browse-course');
        if (back) back.hidden = !courseMode;
        if (browse) browse.hidden = courseMode;
        fileStatuses.forEach(msg => applyFileStatus(msg));
        updateActionLabel();
        syncSelectAllCheckbox();
    }

    function startCourseScan(force = false) {
        courseState = { ...courseState, scanning: true, error: '' };
        renderFiles();
        sendToContentScript({ action: 'scan_course', force }, response => {
            if (!response?.success) { courseState = { ...courseState, scanning: false, error: 'Could not scan this course. Try rescan.' }; renderFiles(); }
        });
    }

    document.addEventListener('cdl-course-state', event => {
        const firstGroups = courseSelection && courseSelection.groups.length === 0;
        courseState = event.detail;
        if (!courseSelection) return;
        courseSelection.update(courseState.groups || []);
        if (firstGroups && courseState.groups?.length) expandedModules.add(courseState.groups[0].id);
        const rescan = document.getElementById('cdl-rescan-btn');
        if (rescan) rescan.classList.toggle('is-spinning', courseState.scanning);
        if (document.getElementById('cdl-toolbar')) renderFiles();
    });

    function onToggleSelect(href, checked) {
        if (checked) selectedHrefs.add(href);
        else selectedHrefs.delete(href);
        updateActionLabel();
        syncSelectAllCheckbox();
    }

    function syncSelectAllCheckbox() {
        const selectAllCheckbox = document.getElementById('cdl-select-all-checkbox');
        if (!selectAllCheckbox) return;
        const total = courseMode && courseSelection ? window.CanvasDownloader.uniqueFiles(courseSelection.groups.flatMap(group => group.files)).length : currentFiles.length;
        const selected = courseMode && courseSelection ? courseSelection.files().length : selectedHrefs.size;
        selectAllCheckbox.checked = total > 0 && selected === total;
        selectAllCheckbox.indeterminate = selected > 0 && selected < total;
    }

    function visibleFileCount() {
        return courseMode && courseSelection ? window.CanvasDownloader.uniqueFiles(courseSelection.groups.flatMap(group => group.files)).length : currentFiles.length;
    }
    function updateActionLabel() {
        const total = courseMode && courseSelection ? window.CanvasDownloader.uniqueFiles(courseSelection.groups.flatMap(group => group.files)).length : currentFiles.length;
        const selected = courseMode && courseSelection ? courseSelection.files().length : selectedHrefs.size;
        const label = (selected === total) ? 'Download All' : `Download Selected (${selected})`;

        const mainTitle = document.querySelector('.cdl-main-title');
        const downloadAllText = document.getElementById('cdl-download-all-text');
        if (mainTitle) mainTitle.textContent = label;
        if (downloadAllText) downloadAllText.textContent = label;
        const button = document.getElementById('cdl-main-btn');
        if (button) button.disabled = isDownloading || selected === 0 || (courseMode && (courseState.scanning || !courseState.complete || !!courseState.error));
    }

    // ============================================================
    // Download Actions
    // ============================================================
    function downloadSelected(override, zipOverride) {
        const filesToDownload = override || (courseMode && courseSelection ? courseSelection.files() : currentFiles.filter(f => selectedHrefs.has(f.href)));
        if (filesToDownload.length === 0) return;

        activeRunId = `cdl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        runFiles = filesToDownload.map(file => ({ ...file }));
        runZip = zipOverride === undefined ? zipEnabled : zipOverride;
        failedFiles.clear();
        document.getElementById('cdl-retry-failed').hidden = true;

        isDownloading = true;
        updateActionLabel();
        const btnGroup = document.getElementById('cdl-button-group');
        const progressBar = document.getElementById('cdl-loading-bar');

        // Enter loading state
        btnGroup.classList.add('is-loading');
        progressBar.style.width = '0%';

        // Mark selected file items as queued
        filesToDownload.forEach(f => {
            const item = document.querySelector(`.cdl-file-item[data-href="${CSS.escape(f.href)}"]`);
            if (item) setFileItemStatus(item, 'queued');
        });

        // Send batch to content.js for URL resolution → then service worker for download
        sendToContentScript({
            action: runZip ? 'resolve_and_download_batch_zip' : 'resolve_and_download_batch',
            files: runFiles,
            runId: activeRunId,
            courseName: getCourseNameFromPage()
        }, (response) => {
            if (response && response.success && response.resolved !== 0) {
                // Initial progress update
                if (isDownloading) progressBar.style.width = `${Math.max(5, parseFloat(progressBar.style.width) || 0)}%`;
            } else {
                isDownloading = false;
                btnGroup.classList.remove('is-loading');
                const summary = document.getElementById('cdl-run-summary');
                summary.hidden = false;
                summary.textContent = response?.error || 'No files could be downloaded. Retry the failed files.';
                document.getElementById('cdl-retry-failed').hidden = failedFiles.size === 0;
                updateActionLabel();
            }
        });
    }

    function downloadSingle(file, itemElement) {
        const key = window.CanvasDownloader.getResourceKey(file.href);
        if (pendingSingles.has(key)) return;
        pendingSingles.add(key);
        setFileItemStatus(itemElement, 'loading');

        sendToContentScript({
            action: 'resolve_and_download',
            file: file
        }, (response) => {
            if (!response || !response.success) {
                pendingSingles.delete(key);
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
    // Per-File Status Handler (shared by service worker messages + DOM events)
    // ============================================================
    function handleFileStatus(msg) {
        fileStatuses.set(window.CanvasDownloader.getResourceKey(msg.href), msg);
        if (msg.runId === activeRunId && activeRunId) {
            const key = window.CanvasDownloader.getResourceKey(msg.href);
            if (msg.status === 'error') failedFiles.add(key);
            else if (msg.status === 'success') failedFiles.delete(key);
        }
        if (msg.status === 'success' || msg.status === 'error') {
            pendingSingles.delete(window.CanvasDownloader.getResourceKey(msg.href));
        }
        if (!isDownloading && msg.status === 'success') {
            failedFiles.delete(window.CanvasDownloader.getResourceKey(msg.href));
            const retry = document.getElementById('cdl-retry-failed');
            if (retry) retry.hidden = failedFiles.size === 0;
        }
        applyFileStatus(msg);
    }

    function applyFileStatus(msg) {
        document.querySelectorAll('.cdl-file-item[data-href]').forEach(item => {
            if (window.CanvasDownloader.getResourceKey(item.dataset.href) === window.CanvasDownloader.getResourceKey(msg.href)) setFileItemStatus(item, msg.status);
        });

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

    // Listen for file status from content.js (DOM event — for resolution failures)
    document.addEventListener('cdl-file-status', (e) => {
        if (e.detail && e.detail.action === 'download_file_status') {
            handleFileStatus(e.detail);
        }
    });

    // ============================================================
    // Listen for Progress Updates from Service Worker
    // ============================================================
    chrome.runtime.onMessage.addListener((msg) => {
        if ((msg.action === 'download_progress' || msg.action === 'download_zip_progress') && activeRunId && msg.runId !== activeRunId) return;
        // Per-file status update (from download engine via service worker)
        if (msg.action === 'download_file_status') {
            handleFileStatus(msg);
        }

        // Overall progress update
        if (msg.action === 'download_progress') {
            if (!isDownloading) return; // Only process if toolbar-initiated download is active

            const btnGroup = document.getElementById('cdl-button-group');
            const progressBar = document.getElementById('cdl-loading-bar');
            const countBadge = document.getElementById('cdl-file-count');
            const summary = document.getElementById('cdl-run-summary');
            summary.hidden = false;
            summary.textContent = `${msg.completed} downloaded, ${msg.errors || 0} failed of ${msg.total}`;

            if (btnGroup && progressBar) {
                if (msg.done) {
                    progressBar.style.width = '100%';
                    btnGroup.classList.remove('is-loading');
                    btnGroup.classList.add('is-success');
                    isDownloading = false;
                    document.getElementById('cdl-retry-failed').hidden = failedFiles.size === 0;
                    updateActionLabel();
                    const successText = document.querySelector('#cdl-success-state span');
                    if (successText) successText.textContent = msg.errors ? 'Finished with failures' : 'Downloaded!';

                    // Reset after viewing success state for 3 seconds
                    setTimeout(() => {
                        btnGroup.classList.remove('is-success');
                        progressBar.style.width = '0%';
                        if (countBadge) countBadge.textContent = `(${visibleFileCount()} File${visibleFileCount() === 1 ? '' : 's'})`;
                    }, 3000);
                } else {
                    const percent = Math.round(((msg.completed + (msg.errors || 0)) / msg.total) * 100);
                    progressBar.style.width = `${Math.max(5, percent)}%`;
                    if (countBadge) countBadge.textContent = `(${msg.completed}/${msg.total})`;
                }
            }
        }

        // Zip bundle progress (fetching/zipping/done/error)
        if (msg.action === 'download_zip_progress') {
            if (!isDownloading) return;

            const btnGroup = document.getElementById('cdl-button-group');
            const progressBar = document.getElementById('cdl-loading-bar');
            const successState = document.getElementById('cdl-success-state');
            const countBadge = document.getElementById('cdl-file-count');
            if (!btnGroup || !progressBar) return;

            if (msg.phase === 'error') {
                btnGroup.classList.remove('is-loading');
                isDownloading = false;
                progressBar.style.width = '0%';
                const summary = document.getElementById('cdl-run-summary');
                summary.hidden = false;
                summary.textContent = 'Could not save the ZIP. Retry the failed files.';
                runFiles.forEach(file => failedFiles.add(window.CanvasDownloader.getResourceKey(file.href)));
                document.getElementById('cdl-retry-failed').hidden = false;
                updateActionLabel();
                return;
            }

            if (msg.phase === 'zipping') {
                progressBar.style.width = '95%';
                return;
            }

            if (msg.phase === 'done') {
                progressBar.style.width = '100%';
                if (successState) successState.querySelector('span').textContent = 'Zipped!';
                btnGroup.classList.remove('is-loading');
                btnGroup.classList.add('is-success');
                isDownloading = false;
                const summary = document.getElementById('cdl-run-summary');
                summary.hidden = false;
                summary.textContent = `${msg.completed} files in ZIP, ${msg.errors || 0} failed`;
                document.getElementById('cdl-retry-failed').hidden = failedFiles.size === 0;
                updateActionLabel();

                setTimeout(() => {
                    btnGroup.classList.remove('is-success');
                    progressBar.style.width = '0%';
                    if (successState) successState.querySelector('span').textContent = 'Downloaded!';
                    if (countBadge) countBadge.textContent = `(${visibleFileCount()} File${visibleFileCount() === 1 ? '' : 's'})`;
                }, 3000);
                return;
            }

            // phase === 'fetching'
            const percent = Math.round((msg.completed / msg.total) * 100);
            progressBar.style.width = `${Math.max(5, percent)}%`;
            if (countBadge) countBadge.textContent = `(${msg.completed}/${msg.total})`;
        }
    });

    document.addEventListener('cdl-resolution-progress', event => {
        if (!isDownloading || event.detail.runId !== activeRunId) return;
        const summary = document.getElementById('cdl-run-summary');
        summary.hidden = false;
        summary.textContent = `Preparing ${event.detail.completed}/${event.detail.total} files…`;
    });

    // ============================================================
    // Listen for File Data from content.js
    // ============================================================
    document.addEventListener('cdl-files-ready', (e) => {
        if (e.detail && e.detail.files) {
            const previousHrefs = new Set(currentFiles.map(f => f.href));
            currentFiles = e.detail.files;
            // Default-select any file we haven't seen before; drop hrefs that
            // no longer exist. Keeps "download everything" as the default on
            // first load/rescan while preserving in-session deselections.
            const currentHrefs = new Set(currentFiles.map(f => f.href));
            selectedHrefs.forEach(href => { if (!currentHrefs.has(href)) selectedHrefs.delete(href); });
            currentFiles.forEach(f => { if (!previousHrefs.has(f.href)) selectedHrefs.add(f.href); });

            renderFiles();
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
            renderFiles();
        }
    });

    // ============================================================
    // Initialize
    // ============================================================
    function init() {
        // Minimal delay — document_idle already guarantees DOM readiness
        setTimeout(() => {
            injectToolbar();
            injectInlineButtons();

            // Request current file data from content.js in case we loaded after it
            sendToContentScript({ action: 'get_files' }, (response) => {
                if (response && response.files && response.isCanvas) {
                    currentFiles = response.files;
                    selectedHrefs = new Set(currentFiles.map(f => f.href));
                    renderFiles();
                    injectInlineButtons();
                }
            });
            if (courseMode && courseSelection) startCourseScan();
        }, 50);

        // Periodically check for new links that might have been rendered
        setInterval(injectInlineButtons, 2000);
    }

    init();
})();
