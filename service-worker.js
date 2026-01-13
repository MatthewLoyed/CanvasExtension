// Service worker placeholder
chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => { });

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url?.includes('instructure.com')) {
        // Instead of a blind message, we check if someone is home first
        try {
            await chrome.tabs.sendMessage(tabId, { action: 'ping' });
            // If ping succeeds, then send the refresh
            chrome.tabs.sendMessage(tabId, { action: 'navigation_refresh' });
        } catch (e) {
            // If ping fails, the content script isn't ready. 
            // We don't need to do anything; the script will talk to us when it loads.
        }
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
