let allResources = [];
let port = null;

const SUPPORTED_DOMAINS = [
  'instructure.com',
  'canvas.msstate.edu',
  'learnx.alueducation.com'
];

const DOWNLOAD_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
    <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
    <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
  </svg>`;

// DOM Elements
const fileListContainer = document.getElementById('file-list');
const searchInput = document.getElementById('search-input');
const statusFooter = document.getElementById('status-footer');

// --- Connection & Injection Management ---

function showLoading() {
  fileListContainer.innerHTML = `
  <div class="message-placeholder">
    <div class="loader"></div>
    <p>Scanning Canvas...</p>
  </div>`;
}

// Helper to suppress runtime errors when pinging a tab that might not have a content script yet
function safeSendMessage(tabId, message, callback) {
  chrome.tabs.sendMessage(tabId, message, (response) => {
    // Explicitly access lastError to effectively "catch" it and prevent the red console error
    const err = chrome.runtime.lastError;
    if (err) {
      // Debug only
      // console.debug("safeSendMessage caught error (expected during init):", err.message);
    }
    if (callback) {
      callback(err ? null : response);
    }
  });
}

async function ensureContentScript() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    return;
  }

  const isCanvas = SUPPORTED_DOMAINS.some(domain => tab.url.includes(domain));

  if (!isCanvas) return;

  showLoading();

  // Check if content script is already there using the safe wrapper
  safeSendMessage(tab.id, { action: 'ping' }, (response) => {
    if (!response) {
      // Ping failed (no response or error caught), so proper 'lastError' suppression happened inside safeSendMessage.
      // Now proceed to inject.
      chrome.runtime.sendMessage({ action: 'inject_script', tabId: tab.id }, (injectRes) => {
        const err = chrome.runtime.lastError; // Suppress LAST ERROR
        if (err) return;

        if (injectRes && injectRes.success) {
          setTimeout(connectToContentScript, 150);
        }
      });
    } else {
      // Ping succeeded, just connect
      connectToContentScript();
    }
  });
}


function connectToContentScript(retries = 3) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) return;

    try {
      if (port) {
        port.disconnect();
      }
      port = chrome.tabs.connect(tabId, { name: 'sidepanel-connection' });

      port.onMessage.addListener((msg) => {
        if (msg.action === 'update_files') {
          allResources = msg.data;
          updateStatus(msg.stats);
          renderList(allResources, searchInput.value);
        }
      });

      port.onDisconnect.addListener(() => {
        // --- THE FIX IS HERE ---
        // We must access chrome.runtime.lastError to suppress the console error
        const err = chrome.runtime.lastError;
        // Optional: console.debug("Port disconnected:", err ? err.message : "Clean disconnect");

        port = null;
        if (retries > 0) {
          setTimeout(() => connectToContentScript(retries - 1), 500);
        }
      });
    } catch (err) {
      if (retries > 0) {
        setTimeout(() => connectToContentScript(retries - 1), 500);
      }
    }
  });
}

// Initial session
ensureContentScript();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    if (port) {
      port.disconnect();
      port = null;
    }
    setTimeout(ensureContentScript, 200);
  }
});

chrome.tabs.onActivated.addListener(() => {
  if (port) {
    port.disconnect();
    port = null;
  }
  ensureContentScript();
});

// Search Logic
searchInput.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();
  renderList(allResources, query);
});

function updateStatus(stats) {
  if (!statusFooter) return;
  if (stats && stats.queue > 0) {
    statusFooter.innerHTML = `<div class="loader"></div> Scanning... (Queue: ${stats.queue})`;
    statusFooter.style.display = 'flex';
  } else {
    statusFooter.style.display = 'none';
  }
}

// --- Download Logic with Professional Queue ---
class DownloadQueue {
  constructor(concurrency = 4, delay = 100) {
    this.queue = [];
    this.active = 0;
    this.concurrency = concurrency;
    this.delay = delay;
    this.total = 0;
    this.completed = 0;
    this.errors = 0;
  }

  add(fileItem) {
    this.queue.push(fileItem);
    this.total++;
    // Set initial UI state to Queued
    const btn = findButtonForUrl(fileItem.href);
    if (btn) setButtonState(btn, 'queued');

    this.updateUI();
    this.process();
  }

  addBatch(fileItems) {
    fileItems.forEach(item => {
      this.queue.push(item);
      this.total++;
      // Set initial UI state to Queued
      const btn = findButtonForUrl(item.href);
      if (btn) setButtonState(btn, 'queued');
    });
    this.updateUI();
    this.process();
  }

  updateUI() {
    if (this.total > 0 && btnBulkDownload) {
      if (this.queue.length === 0 && this.active === 0) {
        btnBulkDownload.innerText = `Done! Use "Bulk Download" for more`;
        setTimeout(() => { btnBulkDownload.innerText = 'Bulk Download All'; this.reset(); }, 4000);
      } else {
        btnBulkDownload.innerText = `Downloading: ${this.completed}/${this.total} (${this.queue.length} left)`;
      }
    }
  }

  reset() {
    this.total = 0;
    this.completed = 0;
    this.errors = 0;
  }

  process() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      this.startNext();
    }
  }

  async startNext() {
    this.active++;
    const item = this.queue.shift();

    // Find the button for this item to show status
    const btn = findButtonForUrl(item.href);
    if (btn) setButtonState(btn, 'loading');

    try {
      const finalUrl = await resolveDownloadUrl(item.href);

      if (!finalUrl) {
        throw new Error("Could not resolve a valid binary file.");
      }

      // -- SANITIZATION STEP --
      // We try the "Pretty" name first.
      const safeName = getSafeFilename(item.text, item.type);
      const safeCourse = getSafeFilename(item.courseName || "General", ""); // Removed .replace dots hack, handled by getSafeFilename now

      const relativePath = `Canvas_Resources/${safeCourse}/${safeName}`;

      // Internal helper to perform the actual download call
      const attemptDownload = (url, path, isRetry = false) => {
        chrome.downloads.download({
          url: url,
          filename: path,
          conflictAction: 'uniquify'
        }, (id) => {
          const err = chrome.runtime.lastError;
          if (err) {
            // -- FALLBACK LOGIC --
            if (!isRetry) {
              // If it failed, it might be the filename. Retry with a Safe ID.
              console.warn("Download failed with pretty name, retrying with fallback...", err.message);

              const cleanExt = (item.type && item.type.startsWith('.')) ? item.type : '.file';
              const fallbackName = `Canvas_File_${Date.now()}_${Math.floor(Math.random() * 1000)}${cleanExt}`;
              const fallbackPath = `Canvas_Resources/${safeCourse}/fallback/${fallbackName}`;

              // RECURSIVE RETRY
              attemptDownload(url, fallbackPath, true);
            } else {
              // Double fail
              if (btn) setButtonState(btn, 'error', "OS System Error"); // Shortened for UI
              this.errors++;
              this.active--;
              this.updateUI();
              setTimeout(() => this.process(), this.delay);
            }
          } else {
            // SUCCESS
            if (btn) {
              setButtonState(btn, 'success');
              if (isRetry) {
                // Optionally startle them slightly to let them know it was renamed
                btn.title = "Saved (Renamed due to OS error)";
              }
            }
            this.completed++;
            this.active--;
            this.updateUI();
            setTimeout(() => this.process(), this.delay);
          }
        });
      };

      // Trigger the first attempt
      attemptDownload(finalUrl, relativePath, false);

    } catch (err) {
      if (btn) setButtonState(btn, 'error', err.message);
      this.errors++;
      this.active--;
      this.updateUI();
      setTimeout(() => this.process(), this.delay);
    }
  }
}

const downloadMonitor = new DownloadQueue();

// Helper: Find button in DOM by href (approximate)
function findButtonForUrl(href) {
  const cards = document.querySelectorAll('.file-card');
  for (const card of cards) {
    const link = card.querySelector('a.file-name');
    if (link && link.href === href) {
      return card.querySelector('button.btn-icon');
    }
  }
  return null;
}

function setButtonState(btn, state, msg = '') {
  if (!btn) return;
  if (state === 'queued') {
    btn.innerHTML = '<span style="font-size: 10px; color: var(--text-muted); font-weight: 600;">QUEUED</span>';
    btn.title = "Waiting in queue...";
    btn.classList.remove('success', 'error');
  } else if (state === 'loading') {
    btn.innerHTML = '<div class="loader" style="width:12px;height:12px;border-width:2px;"></div>';
    btn.title = "Resolving...";
    btn.classList.remove('success', 'error');
  } else if (state === 'success') {
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
    </svg>`;
    btn.title = "Downloaded (Click to download again)";
    btn.classList.add('success');
    btn.classList.remove('error');
  } else if (state === 'error') {
    btn.innerHTML = '❌';
    btn.title = msg || "Failed";
    btn.classList.add('error');
    btn.classList.remove('success');
  }
}

function getSafeFilename(text, extension = ".pdf") {
  if (!text) return "download" + extension;

  // 1. Basic Reserve Char Strip (Windows: < > : " / \ | ? *)
  // Replaces them with underscore
  let clean = text.replace(/[<>:"/\\|?*]/g, '_');

  // 2. Control Characters (ASCII 0-31, 127) + Non-breaking spaces (nbsp)
  // These often sneak in from copy-pasting and cause silent io failures
  clean = clean.replace(/[\x00-\x1F\x7F\u00A0]/g, '_');

  // 3. Trim whitespace and trailing periods (Windows hates trailing dots)
  clean = clean.trim().replace(/\.+$/, '');

  // 4. Handle Windows Reserved Names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
  // If the filename matches these (case-insensitive), prepend an underscore
  const reservedRegex = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  if (reservedRegex.test(clean)) {
    clean = "_" + clean;
  }

  // 5. Length Truncation
  // Windows MAX_PATH is 260. We reserve space for the directory structure.
  // 120 chars is a safe upper bound for the filename itself.
  if (clean.length > 120) {
    clean = clean.substring(0, 120).trim();
  }

  // 6. Ensure Extension
  if (extension) {
    const ext = extension.startsWith('.') ? extension : `.${extension}`;
    // Check if it ALREADY ends with that extension (case-insensitive)
    if (!clean.toLowerCase().endsWith(ext.toLowerCase())) {
      clean += ext;
    }
  }

  // Final fallback if we stripped everything away
  if (clean.length === 0 || clean === extension) {
    return "download" + extension;
  }

  return clean;
}


async function resolveDownloadUrl(originalUrl) {
  let u = new URL(originalUrl);

  // 1. CLUSTER BYPASS: Always trust verified storage links
  if (originalUrl.includes('canvas-user-content.com')) return originalUrl;

  // 2. CANVAS API STRATEGY (Strict)
  const fileIdMatch = u.pathname.match(/\/files\/(\d+)/);
  const isActualCanvas = SUPPORTED_DOMAINS.some(domain => u.hostname.includes(domain));

  if (fileIdMatch && isActualCanvas) {
    const fileId = fileIdMatch[1];
    const apiUrl = `${u.origin}/api/v1/files/${fileId}`;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        // Ask Content Script to fetch the API (using user cookies)
        const response = await new Promise((resolve) => {
          safeSendMessage(tab.id, {
            action: 'resolve_canvas_url',
            apiUrl: apiUrl
          }, (res) => resolve(res));
        });

        if (response && response.success && response.url) {
          return response.url; // ✅ Success: API gave us the clean link
        }
      }
    } catch (err) {
      // API failed
    }
    return null; // 🛑 Strict Mode: If Canvas API fails, abort (don't risk .htm)
  }

  // 3. EXTERNAL / PUBLIC FILES (The "Unpacker" Strategy)
  try {
    // Check what the server is ACTUALLY giving us
    const response = await fetch(u.href, { method: 'HEAD', credentials: 'include' });

    if (!response.ok) return null; // Link is dead

    const type = response.headers.get('Content-Type');

    // IF SERVER SAYS IT'S HTML (Even if URL ends in .pdf)
    if (type && type.includes('text/html')) {
      // --- USE YOUR FUNCTION HERE ---
      const realFileUrl = await unpackIntermediatePage(u.href);

      if (realFileUrl) {
        return realFileUrl; // ✅ Success: We found the binary inside the wrapper
      }

      return null; // 🛑 Failed: It was just a login page or error screen. Abort.
    }

    // IF SERVER SAYS IT'S BINARY (PDF, DOCX, etc)
    return u.href;

  } catch (e) {
    // If we can't verify it, we return null to be safe, 
    // OR we can try to unpack it blindly if you prefer aggressive scraping.
    return null;
  }
}

async function unpackIntermediatePage(wrapperUrl) {
  try {
    const response = await fetch(wrapperUrl, { credentials: 'include' });
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Strategy: 1. Links ending in .pdf, 2. Buttons with 'download' classes, 3. Canvas-specific file links
    const selectors = [
      'a[href$=".pdf"]',
      'a[href$=".docx"]',
      'a[href$=".pptx"]',
      'a[href$=".zip"]',
      'a[href$=".xlsx"]',
      'a[href*="/files/"][href*="/download"]',
      'a.download-button',
      '.instructure_file_link',
      '#download_url'
    ];

    for (const selector of selectors) {
      const link = doc.querySelector(selector);
      if (link && link.href) {
        // Ensure we return an absolute URL
        const absolute = new URL(link.getAttribute('href'), wrapperUrl).href;
        // Avoid infinite recursion if it finds itself
        if (absolute !== wrapperUrl) {
          return absolute;
        }
      }
    }


    return null;
  } catch (e) {
    return null;
  }
}

async function getTrueFileUrlFromModuleItem(moduleItemUrl) {
  // Fetch the wrapper page
  const res = await fetch(moduleItemUrl, { credentials: 'include' });
  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, 'text/html');

  // Look for the standard "Download" link in the header or module sequence footer
  // Canvas usually puts the file link in a `data-api-endpoint` or similar.
  // Common selector for the direct download link on a File Module Item page:
  const fileLink = doc.querySelector('a[href*="/files/"][href*="/download"]');

  if (fileLink) {
    return fileLink.href;
  }

  // Fallback: Look for any link to /files/ that isn't the preview
  const anyFile = Array.from(doc.querySelectorAll('a[href*="/files/"]'))
    .find(a => !a.href.includes('preview') && !a.href.includes('wrap=1'));

  if (anyFile) {
    let u = new URL(anyFile.href, moduleItemUrl);
    u.searchParams.set('download_frd', '1');
    return u.href;
  }

  throw new Error("Could not extract file URL from module page.");
}

function renderList(resources, highlightQuery = '') {
  fileListContainer.innerHTML = '';
  const query = highlightQuery ? highlightQuery.toLowerCase() : '';

  let filtered = resources;
  if (query) {
    filtered = resources.filter(r => r.text && r.text.toLowerCase().includes(query));
  }

  if (filtered.length === 0) {
    fileListContainer.innerHTML = `
      <div class="message-placeholder">
          <svg class="empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"></path>
          </svg>
          <p>${query ? 'No matching files found.' : 'Navigate to a specific course page like Modules or Home to start finding files!'}</p>
      </div>`;
    return;
  }

  const highlightText = (text, q) => {
    if (!q) return text;
    try {
      const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      return text.replace(regex, '<span class="highlight">$1</span>');
    } catch (e) {
      return text;
    }
  };

  const directFiles = filtered.filter(r => r.source === 'surface');
  const deepFiles = filtered.filter(r => r.source === 'deep');

  const renderGroup = (title, items) => {
    if (items.length === 0) return;

    const header = document.createElement('div');
    header.className = 'section-header';
    header.innerText = title;
    fileListContainer.appendChild(header);

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'file-card';

      const cleanName = getSafeFilename(item.text, item.type);
      const displayText = highlightText(cleanName, query);
      const subTitle = item.context;

      card.innerHTML = `
          <div class="file-info">
          <a href="${item.href}" class="file-name" title="${item.text}">${displayText}</a>
          <div class="file-meta">
              <span class="badge">${item.type.replace('.', '').toUpperCase()}</span>
              <span class="context-label">${subTitle}</span>
          </div>
          </div>
          `;

      const btn = document.createElement('button');
      btn.className = 'btn-icon';
      btn.title = 'Download';
      btn.innerHTML = DOWNLOAD_ICON;

      // -- Use The Monitor --
      btn.addEventListener('click', () => {
        // Add course name context if available (assuming 'item.parentPage' might have hints, or pass global)
        // For now, we'll try to extract course name from the tab title or URL if we can, 
        // but let's rely on a helper or "General" default for this iteration.
        downloadMonitor.add(item);
      });

      card.appendChild(btn);
      fileListContainer.appendChild(card);
    });
  };

  renderGroup('Directly on this Page', directFiles);
  renderGroup('Found in Modules/Pages', deepFiles);
}

// --- Fake Door / Modal Logic ---
const btnDeepScan = document.getElementById('btn-deep-scan');
const btnBulkDownload = document.getElementById('btn-bulk-download');
const proModal = document.getElementById('pro-modal');
const modalClose = document.getElementById('modal-close');
const btnNotifyMe = document.getElementById('btn-notify-me');
const waitlistEmail = document.getElementById('waitlist-email');
const modalForm = document.getElementById('modal-form');
const modalSuccess = document.getElementById('modal-success');

function showModal() {
  if (proModal) {
    proModal.classList.remove('closing');
    proModal.querySelector('.modal-content').classList.remove('closing');
    proModal.style.display = 'flex';
  }
}

function hideModal() {
  if (!proModal) return;

  const content = proModal.querySelector('.modal-content');
  proModal.classList.add('closing');
  content.classList.add('closing');

  setTimeout(() => {
    proModal.style.display = 'none';
    proModal.classList.remove('closing');
    content.classList.remove('closing');

    // Reset visibility logic...
    if (modalForm) modalForm.style.display = 'block';
    if (modalSuccess) modalSuccess.style.display = 'none';
    if (waitlistEmail) waitlistEmail.value = '';

    const modalHeader = document.querySelector('.modal-header');
    const modalBodyPs = document.querySelectorAll('.modal-body > p');
    if (modalHeader) modalHeader.style.display = 'block';
    if (modalBodyPs) modalBodyPs.forEach(p => p.style.display = 'block');
  }, 200); // Matches CSS animation duration
}

if (btnDeepScan) btnDeepScan.addEventListener('click', showModal);
if (modalClose) modalClose.addEventListener('click', hideModal);

if (proModal) {
  proModal.addEventListener('click', (e) => {
    if (e.target === proModal) {
      hideModal();
    }
  });
}

const FORMSPREE_ENDPOINT = 'https://formspree.io/f/mbddrqao';

if (btnNotifyMe) {
  btnNotifyMe.addEventListener('click', async () => {
    const email = waitlistEmail.value;
    if (!email || !email.includes('@')) {
      alert('Please enter a valid email address.');
      return;
    }

    // UI Loading State
    const originalText = btnNotifyMe.innerText;
    btnNotifyMe.innerText = 'Sending...';
    btnNotifyMe.disabled = true;

    try {
      const response = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: email })
      });

      if (response.ok) {
        modalForm.style.display = 'none';
        modalSuccess.style.display = 'block';

        // Hide the "Coming Soon" header and intro text
        const modalHeader = document.querySelector('.modal-header');
        const modalBodyPs = document.querySelectorAll('.modal-body > p');
        if (modalHeader) modalHeader.style.display = 'none';
        modalBodyPs.forEach(p => p.style.display = 'none');

        // Optional: clear input just in case
        waitlistEmail.value = '';
      } else {
        const data = await response.json();
        if (Object.hasOwn(data, 'errors')) {
          alert("Error: " + data.errors.map(error => error.message).join(", "));
        } else {
          throw new Error('Submission failed');
        }
      }
    } catch (err) {
      alert('There was a problem joining the waitlist. Please try again.');
      btnNotifyMe.innerText = originalText;
      btnNotifyMe.disabled = false;
    }
  });
}

// --- Feedback / Support Logic ---
const btnFeedback = document.getElementById('btn-feedback');
const feedbackModal = document.getElementById('feedback-modal');
const feedbackClose = document.getElementById('feedback-close');
const btnSendFeedback = document.getElementById('btn-send-feedback');
const feedbackType = document.getElementById('feedback-type');
const feedbackMessage = document.getElementById('feedback-message');
const feedbackEmail = document.getElementById('feedback-email');
const feedbackFormContainer = document.getElementById('feedback-form-container');
const feedbackSuccess = document.getElementById('feedback-success');

function showFeedbackModal() {
  if (feedbackModal) {
    feedbackModal.style.display = 'flex';
    // Pre-fill email if they already joined waitlist
    if (feedbackEmail && waitlistEmail && waitlistEmail.value) {
      feedbackEmail.value = waitlistEmail.value;
    }
  }
}

function hideFeedbackModal() {
  if (feedbackModal) {
    const content = feedbackModal.querySelector('.modal-content');
    feedbackModal.classList.add('closing');
    if (content) content.classList.add('closing');

    setTimeout(() => {
      feedbackModal.style.display = 'none';
      feedbackModal.classList.remove('closing');
      if (content) content.classList.remove('closing');

      if (feedbackFormContainer) feedbackFormContainer.style.display = 'block';
      if (feedbackSuccess) feedbackSuccess.style.display = 'none';
      if (btnSendFeedback) {
        btnSendFeedback.innerText = "Send Message";
        btnSendFeedback.disabled = false;
      }
    }, 200);
  }
}

if (btnFeedback) btnFeedback.addEventListener('click', showFeedbackModal);
if (feedbackClose) feedbackClose.addEventListener('click', hideFeedbackModal);
if (feedbackModal) {
  feedbackModal.addEventListener('click', (e) => {
    if (e.target === feedbackModal) hideFeedbackModal();
  });
}

if (btnSendFeedback) {
  btnSendFeedback.addEventListener('click', async () => {
    const message = feedbackMessage.value.trim();
    if (!message) {
      alert("Please enter a message.");
      return;
    }

    const type = feedbackType.value;
    const email = feedbackEmail.value || "Anonymous";

    // Auto-collect tech info
    const version = chrome.runtime.getManifest().version;
    const techInfo = `\n\n-- Tech Info --\nVersion: ${version}\nUser-Agent: ${navigator.userAgent}`;

    const finalBody = `[${type}]\n${message}${techInfo}`;

    // UI Loading
    const originalText = btnSendFeedback.innerText;
    btnSendFeedback.innerText = "Sending...";
    btnSendFeedback.disabled = true;

    try {
      const response = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          message: finalBody,
          _subject: `Extension Feedback: ${type}`
        })
      });

      if (response.ok) {
        feedbackFormContainer.style.display = 'none';
        feedbackSuccess.style.display = 'block';
        feedbackMessage.value = ''; // clear for next time
      } else {
        throw new Error('Submission failed');
      }
    } catch (err) {
      alert("Could not send feedback. Please try again.");
      btnSendFeedback.innerText = originalText;
      btnSendFeedback.disabled = false;
    }
  });
}

// --- Bulk Download Logic ---
if (btnBulkDownload) {
  btnBulkDownload.addEventListener('click', () => {
    if (!allResources || allResources.length === 0) {
      const originText = btnBulkDownload.innerText;
      btnBulkDownload.innerText = "No files found";
      setTimeout(() => btnBulkDownload.innerText = originText, 2000);
      return;
    }

    if (confirm(`Download ${allResources.length} files found on this page?`)) {
      // Enque all items
      downloadMonitor.addBatch(allResources);
    }
  });
}
