// Guard against double injection (manifest + programmatic)
if (window.__cdlContentScriptLoaded) {
  // Already loaded, skip re-init
} else {
  window.__cdlContentScriptLoaded = true;

  // State
  let isDeepScraping = false;
  const foundResources = new Map(); // key: href, value: resource object
  const visitedPages = new Set();
  const pageQueue = [];
  let scrapeInterval = null;
  let port = null;

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
      if (lowerHref.includes('/folders/') || lowerHref.includes('_preview') || lowerHref.includes('wrap=1')) {
        return;
      }

      const linkText = link.innerText?.trim() || link.getAttribute('title') || 'No Text';

      const fileInfo = detectFile(link, absoluteHref, linkText);
      if (fileInfo) {
        let actualDownloadHref = window.CanvasDownloader.transformDownloadUrl(absoluteHref).url;

        // Tag the link for inline button injection (surface scrape only)
        if (!isDeep) {
          link.setAttribute('data-cdl-link', 'true');
          link.setAttribute('data-cdl-href', actualDownloadHref);
          link.setAttribute('data-cdl-text', linkText);
          link.setAttribute('data-cdl-type', fileInfo.type);
        }

        if (!foundResources.has(actualDownloadHref)) {
          foundResources.set(actualDownloadHref, {
            text: linkText,
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
    // Strategy 1: Breadcrumbs (Safe & Reliable on Canvas)
    // Usually: Courses > Course Name > Modules ...
    try {
      const crumbs = document.querySelectorAll('#breadcrumbs ul li');
      if (crumbs && crumbs.length >= 2) {
        // The second item is usually the Course Title (Index 1)
        // Index 0 is "Dashboard" or "Courses"
        const courseCrumb = crumbs[1];
        const text = courseCrumb.innerText.trim();
        if (text && text.length < 50) return text;
      }
    } catch (e) { }

    // Strategy 2: Page Title (Parsing "Assignment : Course Name")
    try {
      const title = document.title;
      if (title.includes(':')) {
        const parts = title.split(':');
        // Usually the last part is "Canvas" or "Institution", second to last might be course?
        // Actually standard Canvas layout: "Item Name : Course Name : Instructure"
        if (parts.length >= 2) {
          return parts[1].trim();
        }
      }
    } catch (e) { }

    return "General";
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
  }

  init();

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

    if (detail.action === 'resolve_and_download') {
      try {
        const resolvedUrl = await window.CanvasDownloader.resolveFileUrl(detail.file);
        if (!resolvedUrl) {
          sendResponse({ success: false, error: 'Could not resolve URL' });
          return;
        }
        chrome.runtime.sendMessage({
          action: 'download_file',
          url: resolvedUrl,
          filename: detail.file.text,
          courseName: detail.file.courseName,
          originalHref: detail.file.href,
          type: detail.file.type
        });
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.toString() });
      }
      return;
    }

    if (detail.action === 'resolve_and_download_batch') {
      const files = detail.files || [];
      try {
        const resolvedFiles = await Promise.all(files.map(file =>
          window.CanvasDownloader.resolveFileUrl(file).then(resolvedUrl => ({
            url: resolvedUrl,
            filename: file.text,
            courseName: file.courseName,
            originalHref: file.href,
            type: file.type
          }))
        ));
        const validFiles = resolvedFiles.filter(f => f.url);
        if (validFiles.length > 0) {
          chrome.runtime.sendMessage({
            action: 'download_batch',
            files: validFiles
          });
        }
        sendResponse({ success: true, resolved: validFiles.length, failed: files.length - validFiles.length });
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
      window.CanvasDownloader.resolveFileUrl(msg.file)
        .then(resolvedUrl => {
          if (!resolvedUrl) {
            sendResponse({ success: false, error: 'Could not resolve URL' });
            return;
          }
          chrome.runtime.sendMessage({
            action: 'download_file',
            url: resolvedUrl,
            filename: msg.file.text,
            courseName: msg.file.courseName,
            originalHref: msg.file.href,
            type: msg.file.type
          });
          sendResponse({ success: true });
        })
        .catch(err => {
          sendResponse({ success: false, error: err.toString() });
        });
      return true;
    }

    if (msg.action === 'resolve_and_download_batch') {
      const files = msg.files || [];
      Promise.all(files.map(file =>
        window.CanvasDownloader.resolveFileUrl(file).then(resolvedUrl => ({
          url: resolvedUrl,
          filename: file.text,
          courseName: file.courseName,
          originalHref: file.href,
          type: file.type
        }))
      )).then(resolvedFiles => {
        const validFiles = resolvedFiles.filter(f => f.url);
        if (validFiles.length > 0) {
          chrome.runtime.sendMessage({
            action: 'download_batch',
            files: validFiles
          });
        }
        sendResponse({ success: true, resolved: validFiles.length, failed: files.length - validFiles.length });
      }).catch(err => {
        sendResponse({ success: false, error: err.toString() });
      });
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
