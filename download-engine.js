/**
 * download-engine.js
 * 
 * Shared download logic used by the service worker.
 * Imported via importScripts() in service-worker.js.
 * 
 * Provides:
 * - getSafeFilename() — Windows-safe filename sanitization
 * - DownloadQueue — concurrent download queue with progress messaging
 */

// ============================================================
// Filename Sanitization
// ============================================================

function getSafeFilename(text, extension = ".pdf") {
    if (!text) return "download" + extension;

    // 1. Strip reserved characters (Windows: < > : " / \ | ? *)
    let clean = text.replace(/[<>:"/\\|?*]/g, '_');

    // 2. Strip control characters (ASCII 0-31, 127) + non-breaking spaces
    clean = clean.replace(/[\x00-\x1F\x7F\u00A0]/g, '_');

    // 3. Trim whitespace and trailing periods (Windows hates trailing dots)
    clean = clean.trim().replace(/\.+$/, '');

    // 4. Handle Windows reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
    const reservedRegex = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
    if (reservedRegex.test(clean)) {
        clean = "_" + clean;
    }

    // 5. Length truncation (120 chars safe for Windows MAX_PATH)
    if (clean.length > 120) {
        clean = clean.substring(0, 120).trim();
    }

    // 6. Ensure extension
    if (extension) {
        const ext = extension.startsWith('.') ? extension : `.${extension}`;
        if (!clean.toLowerCase().endsWith(ext.toLowerCase())) {
            clean += ext;
        }
    }

    // Final fallback
    if (clean.length === 0 || clean === extension) {
        return "download" + extension;
    }

    return clean;
}

// ============================================================
// Download Queue
// ============================================================

class DownloadQueue {
    constructor(concurrency = 4, delay = 100) {
        this.queue = [];
        this.active = 0;
        this.concurrency = concurrency;
        this.delay = delay;
        this.total = 0;
        this.completed = 0;
        this.errors = 0;
        this._tabId = null; // Tab to send progress updates to
    }

    /**
     * Set the tab ID to send progress messages to.
     */
    setTabId(tabId) {
        this._tabId = tabId;
    }

    /**
     * Add a batch of file items to the queue.
     * Each item: { url, filename, courseName, originalHref, type }
     *  - url: the resolved binary download URL
     *  - filename: display name
     *  - courseName: course folder name
     *  - originalHref: the original href (used as a unique key for status updates)
     *  - type: file extension type
     */
    addBatch(items) {
        items.forEach(item => {
            this.queue.push(item);
            this.total++;
        });
        this._sendProgress();
        this._process();
    }

    addSingle(item) {
        this.queue.push(item);
        this.total++;
        this._sendProgress();
        this._process();
    }

    reset() {
        this.total = 0;
        this.completed = 0;
        this.errors = 0;
    }

    _process() {
        while (this.active < this.concurrency && this.queue.length > 0) {
            this._startNext();
        }
    }

    async _startNext() {
        this.active++;
        const item = this.queue.shift();

        // Notify: file is now downloading
        this._sendFileStatus(item.originalHref, 'loading');

        const safeName = getSafeFilename(item.filename, item.type);
        const safeCourse = getSafeFilename(item.courseName || "General", "");

        let useFolder = false;
        try {
            const res = await new Promise(resolve => chrome.storage.sync.get(['useCanvasResourcesFolder'], resolve));
            useFolder = res.useCanvasResourcesFolder || false;
        } catch (err) {
            console.error(err);
        }

        const relativePath = useFolder ? `Canvas_Resources/${safeCourse}/${safeName}` : safeName;

        const attemptDownload = (url, path, isRetry = false) => {
            chrome.downloads.download({
                url: url,
                filename: path,
                conflictAction: 'uniquify'
            }, (id) => {
                const err = chrome.runtime.lastError;
                if (err) {
                    if (!isRetry) {
                        // Retry with fallback filename
                        const cleanExt = (item.type && item.type.startsWith('.')) ? item.type : '.file';
                        const fallbackName = `Canvas_File_${Date.now()}_${Math.floor(Math.random() * 1000)}${cleanExt}`;
                        const fallbackPath = useFolder ? `Canvas_Resources/${safeCourse}/fallback/${fallbackName}` : `fallback/${fallbackName}`;
                        attemptDownload(url, fallbackPath, true);
                    } else {
                        // Double fail
                        this._sendFileStatus(item.originalHref, 'error', 'Download failed');
                        this.errors++;
                        this.active--;
                        this._sendProgress();
                        setTimeout(() => this._process(), this.delay);
                    }
                } else {
                    // Success
                    this._sendFileStatus(item.originalHref, 'success');
                    this.completed++;
                    this.active--;
                    this._sendProgress();
                    setTimeout(() => this._process(), this.delay);
                }
            });
        };

        attemptDownload(item.url, relativePath, false);
    }

    /**
     * Send overall progress to the requesting tab.
     */
    _sendProgress() {
        const isDone = this.queue.length === 0 && this.active === 0 && this.total > 0;
        const msg = {
            action: 'download_progress',
            total: this.total,
            completed: this.completed,
            errors: this.errors,
            remaining: this.queue.length,
            activeCount: this.active,
            done: isDone
        };

        // Send to the requesting tab's content scripts
        if (this._tabId) {
            chrome.tabs.sendMessage(this._tabId, msg).catch(() => { });
        }

        // Also broadcast to any open side panel
        chrome.runtime.sendMessage(msg).catch(() => { });

        if (isDone) {
            // Auto-reset after a delay, but check if still idle
            setTimeout(() => {
                if (this.queue.length === 0 && this.active === 0) {
                    this.reset();
                }
            }, 5000);
        }
    }

    /**
     * Send per-file status to the requesting tab.
     */
    _sendFileStatus(originalHref, status, errorMsg = '') {
        const msg = {
            action: 'download_file_status',
            href: originalHref,
            status: status, // 'loading' | 'success' | 'error'
            error: errorMsg
        };

        if (this._tabId) {
            chrome.tabs.sendMessage(this._tabId, msg).catch(() => { });
        }
        chrome.runtime.sendMessage(msg).catch(() => { });
    }
}
