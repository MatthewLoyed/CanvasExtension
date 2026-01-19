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
const TARGET_DOMAINS = ['instructure.com', 'canvas.msstate.edu', 'learnx.alueducation.com'];
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
      let actualDownloadHref = transformDownloadUrl(absoluteHref).url;

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

function sendUpdate(extraData = {}) {
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



function transformDownloadUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const isCanvas = TARGET_DOMAINS.some(domain => u.hostname.includes(domain));

    if (!isCanvas) return { url: urlStr, isExternal: true };

    // --- NEW FIX FOR MODULE LINKS ---
    if (u.searchParams.has('module_item_id')) {
      u.searchParams.delete('module_item_id');
    }
    // --------------------------------

    if (u.pathname.includes('/files')) {
      const verifier = u.searchParams.get('verifier');
      const previewId = u.searchParams.get('preview');

      // Handle "Preview" wrapper links
      if (u.pathname.endsWith('/files') && previewId) {
        u.pathname += `/${previewId}/download`;
        u.searchParams.delete('preview');
        u.searchParams.delete('wrap');
      } else {
        // Handle standard file links
        u.searchParams.delete('wrap');
        u.searchParams.delete('preview');
        if (!u.pathname.endsWith('/download')) {
          u.pathname = u.pathname.replace(/\/+$/, '') + '/download';
        }
      }

      if (verifier) u.searchParams.set('verifier', verifier);

      // Force the "File Read" download mode
      u.searchParams.set('download_frd', '1');

      return { url: u.href, isExternal: false };
    }
    return { url: u.href, isExternal: false };
  } catch (e) {
    return { url: urlStr, isExternal: false };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'ping') {
    sendResponse({ status: 'alive' });
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
        // Send the direct binary link back to the sidepanel
        sendResponse({ success: true, url: data.url });
      })
      .catch(err => {
        sendResponse({ success: false, error: err.toString() });
      });
    return true; // Keep the channel open for the async response
  }
});

