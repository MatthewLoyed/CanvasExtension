// Service worker - download orchestration + side panel management
importScripts('download-engine.js');

// --- Side Panel: open on icon click (not auto-open) ---
chrome.action.onClicked.addListener(async (tab) => {
    try {
        await chrome.sidePanel.open({ tabId: tab.id });
    } catch (err) {
        // sidePanel.open() may not be available in older Chrome versions
        console.warn("[SW] Could not open side panel:", err.message);
    }
});

// --- Download Queue Instance ---
const downloadQueue = new DownloadQueue(4, 100);

// --- Message Handlers ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    // Single file download (already resolved URL)
    if (msg.action === 'download_file') {
        downloadQueue.setTabId(msg.tabId || sender.tab?.id);
        downloadQueue.addSingle({
            url: msg.url,
            filename: msg.filename,
            courseName: msg.courseName,
            originalHref: msg.originalHref,
            type: msg.type
        });
        sendResponse({ success: true });
        return;
    }

    // Batch download (already resolved URLs)
    if (msg.action === 'download_batch') {
        downloadQueue.setTabId(msg.tabId || sender.tab?.id);
        downloadQueue.addBatch(msg.files);
        sendResponse({ success: true });
        return;
    }

    // Open side panel (requested by inject-ui.js)
    if (msg.action === 'open_sidepanel') {
        const tabId = msg.tabId || sender.tab?.id;
        if (tabId) {
            chrome.sidePanel.open({ tabId: tabId }).catch(() => { });
        }
        sendResponse({ success: true });
        return;
    }

    // Legacy: inject content script (kept for sidepanel.js compatibility)
    if (msg.action === 'inject_script') {
        chrome.scripting.executeScript({
            target: { tabId: msg.tabId },
            files: ['content.js']
        }).then(() => {
            sendResponse({ success: true });
        }).catch((err) => {
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }
});

// --- Tab Navigation: refresh content script if present ---
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
        chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
            if (chrome.runtime.lastError) {
                return;
            }
            if (response) {
                chrome.tabs.sendMessage(tabId, { action: 'navigation_refresh' }, () => {
                    if (chrome.runtime.lastError) { /* ignore */ }
                });
            }
        });
    }
});
