let allResources = [];
let port = null;

const DOWNLOAD_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
    <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
    <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
  </svg>`;

// DOM Elements
const fileListContainer = document.getElementById('file-list');
const searchInput = document.getElementById('search-input');
const statusFooter = document.getElementById('status-footer');
const settingCanvasFolder = document.getElementById('setting-canvas-folder');

// --- Connection & Injection Management ---

function showLoading() {
  fileListContainer.innerHTML = `
  <div class="message-placeholder">
    <div class="loader"></div>
    <p>Scanning Canvas...</p>
  </div>`;
}

function showNotCanvasMessage() {
  fileListContainer.innerHTML = `
  <div class="message-placeholder">
    <svg class="empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"></path>
    </svg>
    <p>This doesn't look like a Canvas LMS page.</p>
    <p style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">Navigate to your school's Canvas site, then open this panel to scan for files.</p>
  </div>`;
}

// Helper to suppress runtime errors when pinging a tab
function safeSendMessage(tabId, message, callback) {
  chrome.tabs.sendMessage(tabId, message, (response) => {
    const err = chrome.runtime.lastError;
    if (callback) {
      callback(err ? null : response);
    }
  });
}

async function ensureContentScript() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tab || !tab.url) return;

  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
    showNotCanvasMessage();
    return;
  }

  showLoading();

  safeSendMessage(tab.id, { action: 'ping' }, async (response) => {
    if (!response) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        setTimeout(connectToContentScript, 150);
      } catch (err) {
        showNotCanvasMessage();
      }
    } else {
      connectToContentScript();
    }
  });
}


function connectToContentScript(retries = 3) {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) return;

    try {
      if (port) {
        port.disconnect();
      }
      port = chrome.tabs.connect(tabId, { name: 'sidepanel-connection' });

      port.onMessage.addListener((msg) => {
        if (msg.action === 'update_files') {
          if (msg.notCanvas) {
            showNotCanvasMessage();
            return;
          }
          allResources = msg.data;
          updateStatus(msg.stats);
          renderList(allResources, searchInput.value);
        }
      });

      port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError;
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

// --- Download Logic (delegated to service worker) ---

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

/**
 * Download a single file by sending it to the content script for URL resolution,
 * which then forwards to the service worker for actual download.
 */
async function downloadSingleFile(item) {
  const btn = findButtonForUrl(item.href);
  if (btn) setButtonState(btn, 'loading');

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) {
    if (btn) setButtonState(btn, 'error', 'No active tab');
    return;
  }

  safeSendMessage(tab.id, {
    action: 'resolve_and_download',
    file: item
  }, (response) => {
    if (!response || !response.success) {
      if (btn) setButtonState(btn, 'error', response?.error || 'Failed');
    }
    // Success status will come from download_file_status message
  });
}

// Listen for download status updates from service worker
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'download_file_status') {
    const btn = findButtonForUrl(msg.href);
    if (btn) {
      setButtonState(btn, msg.status, msg.error);
    }
  }

  if (msg.action === 'download_progress') {
    if (btnBulkDownload) {
      if (msg.done) {
        btnBulkDownload.innerText = `Done! Use "Bulk Download" for more`;
        setTimeout(() => { btnBulkDownload.innerText = 'Bulk Download All'; }, 4000);
      } else {
        btnBulkDownload.innerText = `Downloading: ${msg.completed}/${msg.total} (${msg.remaining} left)`;
      }
    }
  }
});

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

  // Simple filename sanitization for display (matches download-engine.js logic)
  function getSafeDisplayName(text, extension = ".pdf") {
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
  }

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

      const cleanName = getSafeDisplayName(item.text, item.type);
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

      btn.addEventListener('click', () => {
        downloadSingleFile(item);
      });

      card.appendChild(btn);
      fileListContainer.appendChild(card);
    });
  };

  renderGroup('Directly on this Page', directFiles);
  renderGroup('Found in Modules/Pages', deepFiles);
}

// --- Feedback / Support Logic ---
const FORMSPREE_ENDPOINT = ''; // Set your Formspree endpoint here

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

    const version = chrome.runtime.getManifest().version;
    const techInfo = `\n\n-- Tech Info --\nVersion: ${version}\nUser-Agent: ${navigator.userAgent}`;
    const finalBody = `[${type}]\n${message}${techInfo}`;

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
        feedbackMessage.value = '';
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

// --- Bulk Download Logic (delegated to service worker via content script) ---
const btnBulkDownload = document.getElementById('btn-bulk-download');
if (btnBulkDownload) {
  btnBulkDownload.addEventListener('click', async () => {
    if (!allResources || allResources.length === 0) {
      const originText = btnBulkDownload.innerText;
      btnBulkDownload.innerText = "No files found";
      setTimeout(() => btnBulkDownload.innerText = originText, 2000);
      return;
    }

    if (confirm(`Download ${allResources.length} files found on this page?`)) {
      btnBulkDownload.innerText = "Resolving URLs...";
      btnBulkDownload.disabled = true;

      // Mark all buttons as queued
      allResources.forEach(item => {
        const btn = findButtonForUrl(item.href);
        if (btn) setButtonState(btn, 'queued');
      });

      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab) {
        btnBulkDownload.innerText = "Error: No active tab";
        btnBulkDownload.disabled = false;
        return;
      }

      safeSendMessage(tab.id, {
        action: 'resolve_and_download_batch',
        files: allResources
      }, (response) => {
        if (response && response.success) {
          btnBulkDownload.innerText = `Downloading...`;
        } else {
          btnBulkDownload.innerText = 'Bulk Download All';
          btnBulkDownload.disabled = false;
        }
      });
    }
  });
}

// --- Settings Logic ---
if (settingCanvasFolder) {
  chrome.storage.sync.get(['useCanvasResourcesFolder'], (res) => {
    settingCanvasFolder.checked = res.useCanvasResourcesFolder || false;
  });

  settingCanvasFolder.addEventListener('change', (e) => {
    chrome.storage.sync.set({ useCanvasResourcesFolder: e.target.checked });
  });
}
