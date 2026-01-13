// Service worker placeholder
const SUPPORTED_DOMAINS = [
    'instructure.com',
    'canvas.msstate.edu',
    'learnx.alueducation.com'
];

chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => { });

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    const isCanvas = tab.url && SUPPORTED_DOMAINS.some(domain => tab.url.includes(domain));

    if (changeInfo.status === 'complete' && isCanvas) {
        // We use a callback with lastError check to silence the "Receiving end does not exist" error
        chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
            if (chrome.runtime.lastError) {
                // Content script not ready, silence error
                return;
            }
            if (response) {
                // If ping succeeds, then send the refresh
                chrome.tabs.sendMessage(tabId, { action: 'navigation_refresh' }, () => {
                    if (chrome.runtime.lastError) { /* ignore */ }
                });
            }
        });
    }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
