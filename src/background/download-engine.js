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

const DEBUG = false; // Toggle to true to see full download trace logs

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

// Test-only export — `module` is undefined in the browser/service-worker
// context, so this is inert there and only active under Node/Jest.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getSafeFilename };
}

// ============================================================
// Download Queue
// ============================================================

// Assign module folders once per batch, distinguishing sanitized name collisions.
function prepareModuleFolders(items) {
    const owners = new Map();
    for (const item of items) {
        if (item.moduleId == null) continue;
        const name = getSafeFilename(item.moduleName || 'Module', '');
        const key = name.toLowerCase();
        if (!owners.has(key)) owners.set(key, new Set());
        owners.get(key).add(String(item.moduleId));
    }
    return items.map(item => {
        if (item.moduleId == null) return { ...item };
        const name = getSafeFilename(item.moduleName || 'Module', '');
        const suffix = owners.get(name.toLowerCase()).size > 1 ? ` (${item.moduleId})` : '';
        return { ...item, moduleFolder: name + suffix };
    });
}

function getDownloadPath(item, useFolder, zip = false) {
    const type = item.type && item.type !== 'file' ? item.type : '';
    const name = getSafeFilename(item.filename, type);
    const course = getSafeFilename(item.courseName || 'General', '');
    if (item.moduleId != null) {
        const folder = getSafeFilename(item.moduleFolder || item.moduleName || 'Module', '');
        return zip ? `${folder}/${name}` : `${useFolder ? 'Canvas_Resources/' : ''}${course}/${folder}/${name}`;
    }
    return useFolder ? `${zip ? '' : 'Canvas_Resources/'}${course}/${name}` : name;
}

class DownloadQueue {
    constructor(concurrency = 4, delay = 100) {
        this.concurrency = concurrency;
        this.delay = delay;
        this.queue = [];
        this.active = 0;
        this.runs = new Map();
        this.jobs = new Map();
        this._tabId = null;
        this._saving = Promise.resolve();
        this.ready = this._restore();
        chrome.downloads.onChanged?.addListener(delta => {
            this.ready.then(() => this._changed(delta));
        });
    }
    setTabId(tabId) { this._tabId = tabId; }
    async _restore() {
        try {
            if (!chrome.storage.session) return;
            const data = await chrome.storage.session.get('cdlQueueStateV1');
            const state = data.cdlQueueStateV1;
            if (!state) return;
            this.runs = new Map(state.runs || []);
            this.jobs = new Map(state.jobs || []);
            this.queue = state.queue || [];
            for (const [id] of this.jobs) this._check(id);
            setTimeout(() => this._process(), 0);
        } catch { /* A fresh session has no saved downloads. */ }
    }
    _persist() {
        if (!chrome.storage.session) return;
        const snapshot = {
            runs: [...this.runs].filter(([, run]) => run.completed + run.errors < run.total),
            jobs: [...this.jobs], queue: this.queue.map(item => ({ ...item }))
        };
        // Snapshot primitive counters now; serialize writes to avoid stale state winning.
        snapshot.runs = snapshot.runs.map(([id, run]) => [id, { ...run }]);
        this._saving = this._saving.then(() => chrome.storage.session.set({ cdlQueueStateV1: snapshot })).catch(() => {});
    }
    addBatch(items, options = {}) {
        const tabId = options.tabId || this._tabId;
        const runId = options.runId || `single-${Date.now()}-${Math.random()}`;
        this.ready.then(() => {
            if (this.runs.has(runId)) return;
            const errors = options.initialErrors || 0;
            const run = { id: runId, tabId, total: items.length + errors, completed: 0, errors };
            this.runs.set(runId, run);
            this.queue.push(...prepareModuleFolders(items).map(item => ({ ...item, runId, tabId })));
            this._progress(run);
            this._persist();
            this._process();
        });
    }
    addSingle(item, options) { this.addBatch([item], options); }
    _process() {
        while (this.active < this.concurrency && this.queue.length) this._startNext();
    }
    _send(item, status, error = '') {
        this._notify(item.tabId, { action: 'download_file_status', runId: item.runId, href: item.originalHref, status, error });
    }
    _notify(tabId, message) {
        if (tabId != null) chrome.tabs.sendMessage(tabId, message).catch(() => {});
        chrome.runtime.sendMessage(message).catch(() => {});
    }
    _progress(run) {
        if (!run) return;
        const remaining = Math.max(0, run.total - run.completed - run.errors);
        this._notify(run.tabId, { action: 'download_progress', runId: run.id, total: run.total,
            completed: run.completed, errors: run.errors, remaining, done: remaining === 0 });
    }
    _finish(item, success, error) {
        const run = this.runs.get(item.runId);
        if (!run) return;
        if (success) run.completed++; else run.errors++;
        this._send(item, success ? 'success' : 'error', error);
        this._progress(run);
        this._persist();
        if (run.completed + run.errors === run.total) setTimeout(() => {
            if (this.runs.get(run.id) === run) this.runs.delete(run.id);
        }, 60000);
    }
    _changed(delta) {
        const item = this.jobs.get(delta.id);
        const state = delta.state?.current;
        if (!item || (state !== 'complete' && state !== 'interrupted')) return;
        this.jobs.delete(delta.id);
        this._finish(item, state === 'complete', delta.error?.current || (state === 'interrupted' ? 'Download interrupted' : ''));
    }
    _check(id) {
        chrome.downloads.search?.({ id }, results => {
            if (chrome.runtime.lastError) return;
            const current = results?.[0];
            if (current) this._changed({ id, state: { current: current.state }, error: { current: current.error } });
        });
    }
    async _startNext() {
        this.active++;
        const item = this.queue.shift();
        this._send(item, 'loading');
        let useFolder = false;
        try {
            const settings = await new Promise(resolve => chrome.storage.sync.get(['useCanvasResourcesFolder'], resolve));
            useFolder = !!settings.useCanvasResourcesFolder;
        } catch { /* Use the existing default folder preference. */ }
        const filename = getDownloadPath(item, useFolder);
        const attempt = (path, retried = false) => {
            chrome.downloads.download({ url: item.url, filename: path, conflictAction: 'uniquify' }, id => {
                const error = chrome.runtime.lastError;
                if (error && !retried) {
                    const slash = filename.lastIndexOf('/');
                    const prefix = slash >= 0 ? filename.slice(0, slash + 1) : '';
                    const ext = item.type && item.type !== 'file' ? item.type : '';
                    attempt(`${prefix}Canvas_File_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`, true);
                    return;
                }
                this.active--;
                if (error || id == null) this._finish(item, false, error?.message || 'Could not start download');
                else {
                    this.jobs.set(id, item);
                    this._persist();
                    this._check(id);
                }
                setTimeout(() => this._process(), this.delay);
            });
        };
        attempt(filename);
    }
}

// ============================================================
// Zip Bundle Download
// ============================================================

function _sendZipStatusTo(tabId, originalHref, status, errorMsg = '', runId) {
    const msg = { action: 'download_file_status', href: originalHref, status, error: errorMsg, runId };
    if (tabId) chrome.tabs.sendMessage(tabId, msg).catch(() => { });
    chrome.runtime.sendMessage(msg).catch(() => { });
}

function _sendZipProgress(tabId, progress) {
    const msg = { action: 'download_zip_progress', ...progress };
    if (tabId) chrome.tabs.sendMessage(tabId, msg).catch(() => { });
    chrome.runtime.sendMessage(msg).catch(() => { });
}

/**
 * Fetch a batch of already-resolved files, bundle them into a single .zip,
 * and hand it to chrome.downloads.download() as a base64 data URL.
 * One-shot operation — not part of DownloadQueue since it doesn't need
 * concurrency/retry, just sequential fetch + zip.file() + generate.
 *
 * @param {Array<{url,filename,courseName,originalHref,type}>} items
 * @param {string} zipName
 * @param {number|undefined} tabId
 */
async function buildAndDownloadZip(items, zipName, tabId, options = {}) {
    items = prepareModuleFolders(items);
    const progress = value => _sendZipProgress(tabId, { ...value, runId: options.runId });
    const status = (href, value, error) => _sendZipStatusTo(tabId, href, value, error, options.runId);
    const zip = new JSZip();
    const total = items.length + (options.initialErrors || 0);

    let useFolder = false;
    try {
        const res = await new Promise(resolve => chrome.storage.sync.get(['useCanvasResourcesFolder'], resolve));
        useFolder = res.useCanvasResourcesFolder || false;
    } catch (err) {
        console.error(err);
    }

    let done = 0;
    let errors = options.initialErrors || 0;
    const entryPaths = new Set();
    progress({ phase: 'fetching', completed: 0, total });

    for (const item of items) {
        status(item.originalHref, 'loading');
        try {
            const resp = await fetch(item.url, { credentials: 'include' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            if (/text\/html|application\/xhtml\+xml/i.test(resp.headers.get('Content-Type') || '') &&
                (!(item.allowHtml && item.isCanvasFile) || /\/(login|sso|saml|cas)(?:[/?]|$)/i.test(resp.url || ''))) {
                throw new Error('Received an HTML page instead of a file. Please sign in and retry.');
            }
            const buf = await resp.arrayBuffer();

            const fullPath = getDownloadPath(item, useFolder, true);
            const slash = fullPath.lastIndexOf('/');
            const prefix = slash >= 0 ? fullPath.slice(0, slash + 1) : '';
            const safeName = fullPath.slice(slash + 1);
            const dot = safeName.lastIndexOf('.');
            const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
            const ext = dot > 0 ? safeName.slice(dot) : '';
            let entryPath = prefix + safeName;
            let suffix = 1;
            while (entryPaths.has(entryPath.toLowerCase())) {
                entryPath = `${prefix}${stem} (${suffix++})${ext}`;
            }
            entryPaths.add(entryPath.toLowerCase());

            zip.file(entryPath, buf);
            done++;
            status(item.originalHref, 'success');
        } catch (err) {
            errors++;
            if (DEBUG) console.warn(`[CDL zip] fetch failed for "${item.filename}": ${err.message}`);
            status(item.originalHref, 'error', err.message);
        }
        progress({ phase: 'fetching', completed: done + errors, total });
    }

    if (done === 0) {
        progress({ phase: 'error', done: true, total, completed: 0, errors });
        return;
    }

    progress({ phase: 'zipping', completed: done, total });

    let base64;
    try {
        base64 = await zip.generateAsync({ type: 'base64' });
    } catch (err) {
        if (DEBUG) console.error('[CDL zip] generateAsync failed', err);
        progress({ phase: 'error', done: true, total, completed: done, errors });
        return;
    }

    const safeZipName = getSafeFilename(zipName || 'Canvas_Files', '.zip');

    try {
        await saveArchive({ url: 'data:application/zip;base64,' + base64, filename: safeZipName, conflictAction: 'uniquify' });
        progress({ phase: 'done', done: true, total, completed: done, errors });
    } catch (error) {
        progress({ phase: 'error', done: true, total, completed: done, errors, error: error.message });
    }
}

function saveArchive(options) {
    return new Promise((resolve, reject) => {
        let downloadId;
        const cleanup = () => chrome.downloads.onChanged?.removeListener(changed);
        const changed = delta => {
            if (delta.id !== downloadId) return;
            if (delta.state?.current === 'complete') { cleanup(); resolve(); }
            if (delta.state?.current === 'interrupted') { cleanup(); reject(new Error(delta.error?.current || 'ZIP save interrupted')); }
        };
        chrome.downloads.onChanged?.addListener(changed);
        chrome.downloads.download(options, id => {
            const error = chrome.runtime.lastError;
            if (error || id == null) { cleanup(); reject(new Error(error?.message || 'Could not save ZIP')); return; }
            downloadId = id;
            if (!chrome.downloads.onChanged) { resolve(); return; }
            chrome.downloads.search({ id }, results => {
                if (chrome.runtime.lastError) return;
                const current = results?.[0];
                if (current) changed({ id, state: { current: current.state }, error: { current: current.error } });
            });
        });
    });
}
