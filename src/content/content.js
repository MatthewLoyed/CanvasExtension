// Guard against double injection (manifest + programmatic)
if (window.__cdlContentScriptLoaded) {
  // Already loaded, skip re-init
} else {
  window.__cdlContentScriptLoaded = true;

  // State
  let isDeepScraping = false;
  let scanGeneration = 0; // Incremented on each rescan to invalidate stale scan callbacks
  const foundResources = new Map(); // key: href, value: resource object
  const visitedPages = new Set();
  const pageQueue = [];
  let scrapeInterval = null;
  let port = null;

  /**
   * Deep scan cache helpers — uses sessionStorage to survive page reloads.
   * Canvas does full page navigations between sections (not SPA).
   */
  function getCacheKey(courseId) { return `cdl-deepscan-${courseId}`; }

  function getCachedDeepScan(courseId) {
    try {
      const data = sessionStorage.getItem(getCacheKey(courseId));
      return data ? JSON.parse(data) : null;
    } catch (e) { return null; }
  }

  function setCachedDeepScan(courseId, files) {
    try {
      sessionStorage.setItem(getCacheKey(courseId), JSON.stringify(files));
    } catch (e) { /* Storage full — fail silently */ }
  }

  // Config
  const DELAY_MS = 800; // Rate limiting delay
  const TARGET_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.zip', '.xlsx', '.txt', '.doc', '.ppt', '.xls'];

  // Dynamic Canvas detection — works on any domain
  const DEBUG_CANVAS_DETECTION = true;

  function isCanvasPage() {
    // Check for Canvas-specific DOM landmarks
    const hasCanvasApp = !!document.getElementById('application');
    const hasCanvasNav = !!document.querySelector('.ic-app-nav-toggle-and-main-content');
    const hasBreadcrumbs = !!document.getElementById('breadcrumbs');
    // Check for Canvas ENV object (set by Canvas on every page)
    const hasEnv = typeof window.ENV !== 'undefined';

    const signals = [hasCanvasApp, hasCanvasNav, hasBreadcrumbs, hasEnv];
    const score = signals.filter(Boolean).length;

    if (DEBUG_CANVAS_DETECTION) {
      console.log("[Canvas Downloader] Detection Signals:", {
        hasCanvasApp,
        hasCanvasNav,
        hasBreadcrumbs,
        hasEnv,
        totalScore: score,
        isCanvas: score >= 2
      });
    }

    // A page is Canvas if it has at least 2 of these signals
    return score >= 2;
  }
  const JUNK_KEYWORDS = ['skip to content', 'history', 'jump to', 'toggle', 'next', 'previous', 'breadcrumbs', 'click here'];
  const FILE_ICON_CLASSES = [
    'icon-pdf', 'icon-ms-word', 'icon-ms-ppt',
    'icon-ms-excel', 'icon-zip', 'icon-download', 'icon-paperclip',
    'icon-attachment'
  ];

  /**
   * Main scraping function that parses a root element
   */
  function scrapeRoot(root, sourceUrl, isDeep = false) {
    const links = root.tagName === 'A' ? [root] : root.querySelectorAll('a');
    let foundCount = 0;
    const courseName = getCourseName(); // Extract once per scrape cycle

    links.forEach(link => {
      const href = link.href || link.getAttribute('href') || '';
      if (!href) return;

      const absoluteHref = new URL(href, sourceUrl).href;
      const lowerHref = absoluteHref.toLowerCase();

      if (lowerHref.includes('javascript:') || lowerHref.includes('mailto:')) return;
      if (lowerHref.includes('/folders/')) {
        return;
      }

      const linkText = link.innerText?.trim() || link.getAttribute('title') || 'No Text';

      const fileInfo = detectFile(link, absoluteHref, linkText);
      if (fileInfo) {
        let actualDownloadHref = window.CanvasDownloader.transformDownloadUrl(absoluteHref).url;

        // Use URL filename when link text is generic (e.g., "PDF" → "Syllabus.pdf")
        let displayText = linkText;
        if (window.CanvasDownloader.isGenericLinkText(linkText)) {
          displayText = window.CanvasDownloader.extractFilenameFromUrl(absoluteHref) || linkText;
        }

        // Tag the link for inline button injection (surface scrape only)
        if (!isDeep) {
          link.setAttribute('data-cdl-link', 'true');
          link.setAttribute('data-cdl-href', actualDownloadHref);
          link.setAttribute('data-cdl-text', displayText);
          link.setAttribute('data-cdl-type', fileInfo.type);
        }

        const resourceKey = window.CanvasDownloader.getResourceKey(actualDownloadHref);
        if (!foundResources.has(resourceKey)) {
          foundResources.set(resourceKey, {
            text: displayText,
            href: actualDownloadHref,
            context: isDeep ? `Found in: ${sourceUrl}` : findContext(link),
            type: fileInfo.type,
            source: isDeep ? 'deep' : 'surface',
            parentPage: sourceUrl,
            courseName: courseName // Add this field
          });
          foundCount++;
        }
      }
    });

    return foundCount;
  }

  function getCourseName() {
    return window.CanvasDownloader.getCourseName();
  }

  function detectFile(link, href, text) {
    const lowerHref = href.toLowerCase();
    const lowerText = text.toLowerCase();
    const titleAttr = (link.getAttribute('title') || '').toLowerCase();

    if (JUNK_KEYWORDS.some(k => lowerText.includes(k) || titleAttr.includes(k))) {
      return null;
    }

    const getExt = (str) => {
      const match = str.match(/\.([a-z0-9]{2,5})(\?|#|$)/i);
      if (match) {
        const ext = '.' + match[1].toLowerCase();
        if (TARGET_EXTENSIONS.includes(ext)) return ext;
      }
      return null;
    };

    let type = getExt(lowerHref);

    if (lowerHref.includes('/files/') && !lowerHref.includes('/folder')) {
      if (!type) {
        type = getExt(lowerText) || getExt(titleAttr) || 'file';
      }
      return { type };
    }

    if (lowerHref.includes('/modules/items/') || lowerHref.includes('/module_item_redirect')) {
      const ext = getExt(lowerText) || getExt(titleAttr);
      if (ext) return { type: ext };
      if (hasFileIcon(link)) return { type: 'file' };
      return null;
    }

    if (type) return { type };
    const textExt = getExt(lowerText) || getExt(titleAttr);
    if (textExt) return { type: textExt };

    return null;
  }

  function hasFileIcon(link) {
    if (!link.querySelectorAll) return false;
    const icons = link.querySelectorAll('i, span');
    for (const icon of icons) {
      for (const cls of FILE_ICON_CLASSES) {
        if (icon.classList.contains(cls)) return true;
      }
    }
    return false;
  }

  function findContext(element) {
    let current = element;
    while (current) {
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (/^H[1-6]$/.test(sibling.tagName)) return sibling.innerText.trim();
        const headerInSibling = sibling.querySelector && sibling.querySelector('.ig-header-title, .name, h1, h2, h3, h4, h5, h6');
        if (headerInSibling) return headerInSibling.innerText.trim();
        sibling = sibling.previousElementSibling;
      }
      current = current.parentElement;
      if (!current || current.tagName === 'BODY' || current.id === 'content') break;
    }
    return 'Directly on Page';
  }

  /**
   * Broadcast file data to inject-ui.js via CustomEvent on the document.
   */
  function broadcastToPage() {
    const data = Array.from(foundResources.values());
    document.dispatchEvent(new CustomEvent('cdl-files-ready', {
      detail: { files: data }
    }));
  }

  function sendUpdate(extraData = {}) {
    if (!isCanvasPage()) {
      if (port) {
        port.postMessage({
          action: 'update_files',
          data: [],
          stats: { queue: 0, visited: 0 },
          notCanvas: true
        });
      }
      return;
    }

    const data = Array.from(foundResources.values());
    const msg = {
      action: 'update_files',
      data: data,
      stats: {
        queue: pageQueue.length,
        visited: visitedPages.size
      },
      ...extraData
    };

    if (port) {
      port.postMessage(msg);
    }

    // Also broadcast to inject-ui.js
    broadcastToPage();
  }

  let observer = null;
  let debounceTimer = null;

  function debouncedScrape() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (scrapeRoot(document, window.location.href, false) > 0) {
        sendUpdate();
      }
    }, 500);
  }

  /**
   * Check if the current page is a modules page where deep scan is meaningful.
   * Only run deep scan on course home pages or explicit /modules pages.
   * 
   * @returns {boolean}
   */
  function isModulesPage() {
    const path = window.location.pathname;
    // Match /courses/123 (home) or /courses/123/modules (explicit modules page)
    // Do NOT match /courses/123/grades, /courses/123/assignments, etc.
    return /^\/courses\/\d+\/?$/.test(path) || /^\/courses\/\d+\/modules\/?$/.test(path);
  }

  /**
   * Start automatic deep scan for the current course.
   * Streams results into foundResources and broadcasts updates after each page.
   * Only runs on module pages (course home or /modules).
   */
  function startDeepScan() {
    if (window.CanvasDownloader.isModuleListPage?.()) { startCourseScan(); return; }
    if (!isModulesPage()) return; // Only scan on module pages

    const courseId = window.CanvasDownloader.extractCourseId();
    if (!courseId) return;
    if (isDeepScraping) return; // Already running

    // Check cache first — instant restore if we've already scanned this course
    const cachedFiles = getCachedDeepScan(courseId);
    if (cachedFiles && cachedFiles.length > 0) {
      const courseName = getCourseName();
      for (const file of cachedFiles) {
        const key = window.CanvasDownloader.getResourceKey(file.href);
        if (!foundResources.has(key)) {
          foundResources.set(key, { ...file, courseName });
        }
      }
      sendUpdate();
      document.dispatchEvent(new CustomEvent('cdl-deep-scan-status', {
        detail: { status: 'done', found: foundResources.size, cached: true }
      }));
      return;
    }

    isDeepScraping = true;
    const myScanGen = scanGeneration; // Capture current generation for this scan

    const allDeepFiles = []; // Collect for caching

    window.CanvasDownloader.fetchCourseModules(courseId).then(modules => {
      // If a newer scan was triggered, silently abandon this one
      if (myScanGen !== scanGeneration) return;

      const categories = window.CanvasDownloader.categorizeModuleItems(modules);

      if (categories.pages.length === 0) {
        if (myScanGen === scanGeneration) isDeepScraping = false;
        setCachedDeepScan(courseId, []);
        // No pages to scan — finish silently without ever showing "Scanning..."
        if (myScanGen === scanGeneration) {
          document.dispatchEvent(new CustomEvent('cdl-deep-scan-status', {
            detail: { status: 'done', found: 0 }
          }));
        }
        return;
      }

      // Only show scanning indicator when we actually have pages to scan
      if (myScanGen === scanGeneration) {
        document.dispatchEvent(new CustomEvent('cdl-deep-scan-status', {
          detail: { status: 'scanning', current: 0, total: categories.pages.length }
        }));
      }

      return window.CanvasDownloader.deepScanPages(
        courseId,
        categories.pages,
        150,
        // onProgress: update scanning indicator (only if still current scan)
        ({ current, total, pageTitle }) => {
          if (myScanGen !== scanGeneration) return;
          document.dispatchEvent(new CustomEvent('cdl-deep-scan-status', {
            detail: { status: 'scanning', current, total, pageTitle }
          }));
        },
        // onFilesFound: stream new files into foundResources (only if still current scan)
        (newFiles) => {
          if (myScanGen !== scanGeneration) return;
          const courseName = getCourseName();
          for (const file of newFiles) {
            allDeepFiles.push(file); // Collect for cache
            const key = window.CanvasDownloader.getResourceKey(file.href);
            if (!foundResources.has(key)) {
              foundResources.set(key, { ...file, courseName });
            }
          }
          sendUpdate();
        }
      );
    }).then(() => {
      // Only finalize if this scan is still the current one
      if (myScanGen !== scanGeneration) return;
      isDeepScraping = false;
      // Cache results for this course
      setCachedDeepScan(courseId, allDeepFiles);
      document.dispatchEvent(new CustomEvent('cdl-deep-scan-status', {
        detail: { status: 'done', found: foundResources.size }
      }));
    }).catch(err => {
      if (myScanGen !== scanGeneration) return;
      console.error('[Canvas Downloader] Deep scan error:', err);
      isDeepScraping = false;
      document.dispatchEvent(new CustomEvent('cdl-deep-scan-status', {
        detail: { status: 'error', error: err.toString() }
      }));
    });
  }

  let courseScanGeneration = 0;
  let courseState = { groups: [], scanning: false, complete: false, error: '', completed: 0, total: 0 };
  function publishCourseState() {
    document.dispatchEvent(new CustomEvent('cdl-course-state', { detail: courseState }));
  }
  async function startCourseScan(force = false) {
    const courseId = window.CanvasDownloader.extractCourseId();
    if (!courseId || !window.CanvasDownloader.scanCourse) return;
    if (!force && (courseState.scanning || courseState.complete)) { publishCourseState(); return; }
    if (!force) {
      try {
        const cached = JSON.parse(sessionStorage.getItem(`cdl-course-v1-${courseId}`));
        if (cached && Date.now() - cached.time < 300000 && Array.isArray(cached.groups)) {
          courseState = { groups: cached.groups, scanning: false, complete: true, error: '', completed: cached.groups.length, total: cached.groups.length };
          publishCourseState();
          return;
        }
      } catch { /* Cache misses do not prevent a scan. */ }
    }
    const generation = ++courseScanGeneration;
    courseState = { groups: [], scanning: true, complete: false, error: '', completed: 0, total: 0 };
    publishCourseState();
    try {
      const groups = await window.CanvasDownloader.scanCourse(courseId, update => {
        if (generation !== courseScanGeneration) return;
        courseState = { ...courseState, ...update };
        publishCourseState();
      }, () => generation !== courseScanGeneration);
      if (generation !== courseScanGeneration) return;
      courseState = { ...courseState, groups, scanning: false, complete: true };
      try { sessionStorage.setItem(`cdl-course-v1-${courseId}`, JSON.stringify({ time: Date.now(), groups })); } catch { /* Storage may be full. */ }
    } catch (error) {
      if (generation !== courseScanGeneration) return;
      courseState = { ...courseState, scanning: false, complete: false, error: error.message };
    }
    publishCourseState();
  }

  function init() {
    // Guard: Only run if this looks like a Canvas page
    if (!isCanvasPage()) {
      sendUpdate();
      return;
    }

    foundResources.clear();
    visitedPages.clear();
    pageQueue.length = 0;
    visitedPages.add(window.location.href);

    scrapeRoot(document, window.location.href, false);
    sendUpdate();

    let pollCount = 0;
    const pollInterval = setInterval(() => {
      pollCount++;
      const found = scrapeRoot(document, window.location.href, false);
      if (found > 0) {
        sendUpdate();
      }
      if (pollCount >= 5) {
        clearInterval(pollInterval);
      }
    }, 2000);

    if (observer) observer.disconnect();
    observer = new MutationObserver(() => debouncedScrape());
    observer.observe(document.body, { childList: true, subtree: true });

    // Auto-start deep scan after surface scrape finishes
    if (isModulesPage() && !window.CanvasDownloader.isModuleListPage?.()) {
      const courseId = window.CanvasDownloader.extractCourseId();
      // If no valid cache, signal scanning early so the toolbar doesn't flicker/hide during the 1000ms delay
      if (courseId && !getCachedDeepScan(courseId)) {
        document.dispatchEvent(new CustomEvent('cdl-deep-scan-status', {
          detail: { status: 'scanning' }
        }));
      }
    }

    setTimeout(() => startDeepScan(), 300);
  }

  init();

  // Listen for manual re-scan trigger from inject-ui.js
  document.addEventListener('cdl-trigger-rescan', () => {
    const courseId = window.CanvasDownloader.extractCourseId();
    if (!courseId) return;

    // Invalidate any running scan by bumping the generation counter
    scanGeneration++;
    isDeepScraping = false; // Allow a new scan to start

    // Immediately show "scanning" so toolbar doesn't collapse during clear
    document.dispatchEvent(new CustomEvent('cdl-deep-scan-status', {
      detail: { status: 'scanning' }
    }));

    // Clear deep scan cache for this course
    sessionStorage.removeItem(getCacheKey(courseId));

    // Clear ALL found resources (surface + deep) for a true full rescan
    foundResources.clear();
    sendUpdate(); // Update UI to show 0 files (toolbar stays via scanning state)

    // Small delay so the browser repaints the cleared list before re-populating
    setTimeout(() => {
      // Re-run surface scrape on the current page
      scrapeRoot(document, window.location.href, false);
      sendUpdate();

      // Then start fresh deep scan
      startDeepScan();
    }, 300);
  });

  // ============================================================
  // Shared Download Helpers
  // Consolidates logic used by both CustomEvent & runtime.onMessage handlers
  // ============================================================

  /**
   * Resolve a single file URL and send it to the service worker for download.
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  const pendingSingleDownloads = new Map();
  function resolveAndDownloadSingle(file) {
    const key = window.CanvasDownloader.getResourceKey(file.href);
    if (pendingSingleDownloads.has(key)) return pendingSingleDownloads.get(key);
    const request = sendSingleDownload(file).finally(() => pendingSingleDownloads.delete(key));
    pendingSingleDownloads.set(key, request);
    return request;
  }

  async function sendSingleDownload(file) {
    const resolvedUrl = await window.CanvasDownloader.resolveFileUrl(file);
    if (!resolvedUrl) {
      return { success: false, error: 'Could not resolve URL' };
    }
    await chrome.runtime.sendMessage({
      action: 'download_file',
      url: resolvedUrl,
      filename: file.resolvedName || file.text,
      courseName: file.courseName,
      moduleId: file.moduleId, moduleName: file.moduleName,
      originalHref: file.href,
      type: file.resolvedType || file.type
    });
    return { success: true };
  }

  /**
   * Resolve a batch of file URLs and send valid ones for download.
   * Files that fail resolution get an explicit 'error' status sent to the UI.
   * @returns {Promise<{success: boolean, resolved: number, failed: number}>}
   */
  async function prepareDownloadBatch(files, courseName, zip, runId) {
    const api = window.CanvasDownloader;
    files = api.uniqueFiles(files);
    let prepared = 0;
    const resolve = async file => {
      let url = null;
      try { url = await api.resolveFileUrl(file); } catch { /* Report below. */ }
      const result = {
        ...file, url, filename: file.resolvedName || file.text,
        courseName: file.courseName || courseName, originalHref: file.href,
        type: file.resolvedType || file.type
      };
      document.dispatchEvent(new CustomEvent('cdl-resolution-progress', {
        detail: { runId, completed: ++prepared, total: files.length }
      }));
      if (!url) document.dispatchEvent(new CustomEvent('cdl-file-status', {
        detail: { action: 'download_file_status', runId, href: file.href, status: 'error', error: 'Could not resolve URL' }
      }));
      return result;
    };
    const resolved = api.mapLimit ? await api.mapLimit(files, 4, resolve) : await Promise.all(files.map(resolve));
    const valid = api.uniqueFiles(resolved.filter(file => file.url), file => file.url);
    const failed = resolved.filter(file => !file.url).length;
    if (valid.length) await chrome.runtime.sendMessage({
      action: zip ? 'download_batch_zip' : 'download_batch', files: valid,
      zipName: courseName || api.getCourseName(), runId, initialErrors: failed
    });
    return { success: valid.length > 0, resolved: valid.length, failed };
  }

  function resolveAndDownloadBatch(files, runId) {
    return prepareDownloadBatch(files, window.CanvasDownloader.getCourseName(), false, runId);
  }
  function resolveAndDownloadBatchZip(files, courseName, runId) {
    return prepareDownloadBatch(files, courseName, true, runId);
  }

  // ============================================================
  // CustomEvent listener for inject-ui.js communication
  // (Content scripts in the same tab can't use chrome.runtime.sendMessage
  //  to talk to each other, so we use DOM events)
  // ============================================================
  document.addEventListener('cdl-request', async (e) => {
    const detail = e.detail || {};
    const responseId = detail.responseId;

    function sendResponse(response) {
      document.dispatchEvent(new CustomEvent('cdl-response', {
        detail: { responseId, response }
      }));
    }

    if (detail.action === 'get_files') {
      sendResponse({
        files: Array.from(foundResources.values()),
        isCanvas: isCanvasPage()
      });
      return;
    }

    if (detail.action === 'get_course_state') { sendResponse(courseState); return; }
    if (detail.action === 'scan_course') {
      startCourseScan(!!detail.force);
      sendResponse({ success: true });
      return;
    }

    if (detail.action === 'resolve_and_download') {
      try {
        sendResponse(await resolveAndDownloadSingle(detail.file));
      } catch (err) {
        sendResponse({ success: false, error: err.toString() });
      }
      return;
    }

    if (detail.action === 'resolve_and_download_batch') {
      try {
        sendResponse(await resolveAndDownloadBatch(detail.files || [], detail.runId));
      } catch (err) {
        sendResponse({ success: false, error: err.toString() });
      }
      return;
    }

    if (detail.action === 'resolve_and_download_batch_zip') {
      try {
        sendResponse(await resolveAndDownloadBatchZip(detail.files || [], detail.courseName, detail.runId));
      } catch (err) {
        sendResponse({ success: false, error: err.toString() });
      }
      return;
    }
  });

  chrome.runtime.onConnect.addListener((p) => {
    if (p.name === 'sidepanel-connection') {
      port = p;
      sendUpdate();

      port.onDisconnect.addListener(() => {
        port = null;
        if (observer) observer.disconnect();
      });


    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({
        status: 'alive',
        fileCount: foundResources.size
      });
      return;
    }
    if (msg.action === "navigation_refresh") {
      init();
      return;
    }

    if (msg.action === 'resolve_canvas_url') {
      fetch(msg.apiUrl, { credentials: 'include' })
        .then(response => {
          if (!response.ok) throw new Error("API Path Not Found");
          return response.json();
        })
        .then(data => {
          sendResponse({ success: true, url: data.url });
        })
        .catch(err => {
          sendResponse({ success: false, error: err.toString() });
        });
      return true;
    }

    if (msg.action === 'resolve_and_download') {
      resolveAndDownloadSingle(msg.file)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.toString() }));
      return true;
    }

    if (msg.action === 'resolve_and_download_batch') {
      resolveAndDownloadBatch(msg.files || [], msg.runId)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.toString() }));
      return true;
    }

    if (msg.action === 'resolve_and_download_batch_zip') {
      resolveAndDownloadBatchZip(msg.files || [], msg.courseName, msg.runId)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.toString() }));
      return true;
    }

    if (msg.action === 'deep_scan_test') {
      const courseId = window.CanvasDownloader.extractCourseId();
      console.log('[Deep Scan Test] Course ID:', courseId);
      if (!courseId) {
        sendResponse({ success: false, error: 'No course ID found' });
        return;
      }

      (async () => {
        try {
          // Phase 1: Fetch modules and categorize
          console.log('[Deep Scan Test] === Phase 1: Fetching Modules ===');
          const modules = await window.CanvasDownloader.fetchCourseModules(courseId, (page) => {
            console.log(`[Deep Scan Test] Fetching modules page ${page}...`);
          });
          console.log(`[Deep Scan Test] Modules found: ${modules.length}`);

          const categories = window.CanvasDownloader.categorizeModuleItems(modules);
          console.log(`[Deep Scan Test] Direct files: ${categories.files.length}, Pages: ${categories.pages.length}, Skipped: ${categories.skipped.length}`);

          // Phase 2: Deep scan pages for embedded files
          console.log('[Deep Scan Test] === Phase 2: Scanning Pages ===');
          const deepFiles = await window.CanvasDownloader.deepScanPages(
            courseId,
            categories.pages,
            800,
            ({ current, total, pageTitle }) => {
              console.log(`[Deep Scan Test] Scanning page ${current}/${total}: "${pageTitle}"`);
            }
          );

          console.log(`[Deep Scan Test] === Results ===`);
          console.log(`[Deep Scan Test] Deep-found files: ${deepFiles.length}`);
          deepFiles.forEach(f => console.log(`  📄 [${f.moduleName}] ${f.text} (${f.type}) — from "${f.parentPage}"`));

          sendResponse({
            success: true,
            modules: modules.length,
            directFiles: categories.files.length,
            pages: categories.pages.length,
            deepFiles: deepFiles.length,
            deepFilesList: deepFiles.map(f => ({ text: f.text, type: f.type, parentPage: f.parentPage, href: f.href }))
          });
        } catch (err) {
          console.error('[Deep Scan Test] Error:', err);
          sendResponse({ success: false, error: err.toString() });
        }
      })();
      return true;
    }

    if (msg.action === 'get_files') {
      sendResponse({
        files: Array.from(foundResources.values()),
        isCanvas: isCanvasPage()
      });
      return;
    }
  });


} // end of double-injection guard
