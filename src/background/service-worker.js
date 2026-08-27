// Service worker - download orchestration + side panel management
importScripts('../vendor/jszip.min.js', 'download-engine.js');

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

    // Batch download, bundled into a single .zip (already resolved URLs)
    if (msg.action === 'download_batch_zip') {
        buildAndDownloadZip(msg.files, msg.zipName, msg.tabId || sender.tab?.id);
        sendResponse({ success: true });
        return;
    }

    // Legacy: inject content script (kept for compatibility if needed)
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
