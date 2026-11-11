const DASHBOARD_URL = 'http://localhost:3944/';

// Must be registered synchronously at top-level scope
chrome.tabs.onCreated.addListener((tab) => {
    // Check if the tab is loading our extension's override page
    const targetUrl = tab.pendingUrl || tab.url || '';
    if (targetUrl.includes(chrome.runtime.id) || targetUrl === 'chrome://newtab/') {
        chrome.tabs.update(tab.id, { url: DASHBOARD_URL });
    }
});