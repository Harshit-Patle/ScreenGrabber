// ScreenGrabber background (MV3 service worker)
// Cross-browser: uses tabs.captureTab in Firefox, captureVisibleTab in Chromium.
// Single place to change the interval:
const SCREENSHOT_INTERVAL_MINUTES = 5; // Change this value to adjust cadence

// Keys for chrome.storage.local
const STORAGE_KEYS = {
    running: 'sg_running',
    count: 'sg_count',
    lastTs: 'sg_last_ts',
    nextTs: 'sg_next_ts',
    lastError: 'sg_last_error'
};

// Utility: formatted timestamp for filenames
function getFormattedDateTime() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

// Utility: check if active URL is restricted from extension capture
function isRestrictedUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const restrictedPrefixes = [
        'chrome://',
        'chrome-extension://',
        'edge://',
        'about:',
        'devtools://',
        'view-source:',
        'https://chromewebstore.google.com',
        'https://chrome.google.com/webstore'
    ];
    return restrictedPrefixes.some(prefix => url.startsWith(prefix));
}

// Small promisified helpers for callback-style chrome APIs
const pTabsQuery = (q) => new Promise((res, rej) => chrome.tabs.query(q, r => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(r)));
const pCaptureVisible = (winId, opt) => new Promise((res, rej) => chrome.tabs.captureVisibleTab(winId, opt, r => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(r)));
const pCaptureTab = (tabId, opt) => new Promise((res, rej) => chrome.tabs.captureTab(tabId, opt, r => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(r)));
const pDownload = (opts) => new Promise((res, rej) => chrome.downloads.download(opts, id => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(id)));
const pStorageGet = (keys) => new Promise((res, rej) => chrome.storage.local.get(keys, r => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(r)));
const pStorageSet = (obj) => new Promise((res, rej) => chrome.storage.local.set(obj, () => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res()));
const pStorageRemove = (keys) => new Promise((res, rej) => chrome.storage.local.remove(keys, () => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res()));
const pAlarmGet = (name) => new Promise((res) => chrome.alarms.get(name, res));

// Build a serializable state object for the popup
async function getState() {
    const { [STORAGE_KEYS.running]: running = false,
        [STORAGE_KEYS.count]: count = 0,
        [STORAGE_KEYS.lastTs]: lastTs = null,
        [STORAGE_KEYS.nextTs]: nextTs = null,
        [STORAGE_KEYS.lastError]: lastError = null } = await pStorageGet([
            STORAGE_KEYS.running,
            STORAGE_KEYS.count,
            STORAGE_KEYS.lastTs,
            STORAGE_KEYS.nextTs,
            STORAGE_KEYS.lastError
        ]);
    return {
        running,
        screenshotCount: count,
        lastScreenshotTs: lastTs,
        nextTriggerTs: nextTs,
        intervalMinutes: SCREENSHOT_INTERVAL_MINUTES,
        lastError
    };
}

// Notify any open UI about state changes (best-effort)
async function sendStateUpdate() {
    try {
        const state = await getState();
        chrome.runtime.sendMessage({ type: 'state', state });
    } catch (_) {
        // ignore if no listeners
    }
}

// Cross-browser capture of the active tab as PNG data URL
async function captureActiveTabPng() {
    const [active] = await pTabsQuery({ active: true, currentWindow: true });
    if (!active) throw new Error('No active tab found');
    if (active.url && isRestrictedUrl(active.url)) {
        throw new Error(`Cannot capture restricted page (${active.url.split('/')[0]}//...)`);
    }
    if (typeof chrome.tabs.captureTab === 'function') {
        // Firefox prefers captureTab
        return await pCaptureTab(active.id, { format: 'png' });
    }
    // Chromium path
    return await pCaptureVisible(active.windowId, { format: 'png' });
}

// Take a screenshot and download it, update counters and timestamps
async function takeScreenshot() {
    const dataUrl = await captureActiveTabPng();
    const filename = `ScreenGrabber/ScreenGrabber_${getFormattedDateTime()}.png`;
    await pDownload({ url: dataUrl, filename, conflictAction: 'uniquify', saveAs: false });
    const now = Date.now();
    const s = await getState();
    const count = (s.screenshotCount || 0) + 1;
    await pStorageSet({
        [STORAGE_KEYS.count]: count,
        [STORAGE_KEYS.lastTs]: now,
        [STORAGE_KEYS.lastError]: null
    });
    await sendStateUpdate();
}

// Start: mark running, take an immediate screenshot, schedule repeating alarm
async function startProcess() {
    const s = await getState();
    if (s.running) return s;
    try {
        await takeScreenshot();
        const nextTs = Date.now() + SCREENSHOT_INTERVAL_MINUTES * 60 * 1000;
        await pStorageSet({
            [STORAGE_KEYS.running]: true,
            [STORAGE_KEYS.nextTs]: nextTs,
            [STORAGE_KEYS.lastError]: null
        });
        chrome.alarms.create('sg_alarm', {
            delayInMinutes: SCREENSHOT_INTERVAL_MINUTES,
            periodInMinutes: SCREENSHOT_INTERVAL_MINUTES
        });
        await sendStateUpdate();
        return await getState();
    } catch (err) {
        const errorMsg = err?.message || String(err);
        chrome.alarms.clear('sg_alarm');
        await pStorageSet({
            [STORAGE_KEYS.running]: false,
            [STORAGE_KEYS.nextTs]: null,
            [STORAGE_KEYS.lastError]: errorMsg
        });
        await sendStateUpdate();
        throw err;
    }
}

// Stop: clear alarm, mark not running, clear next trigger
async function stopProcess() {
    chrome.alarms.clear('sg_alarm');
    await pStorageSet({
        [STORAGE_KEYS.running]: false,
        [STORAGE_KEYS.nextTs]: null,
        [STORAGE_KEYS.lastError]: null
    });
    await sendStateUpdate();
    return getState();
}

// Messages from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
        try {
            if (message?.type === 'getState') return sendResponse({ ok: true, state: await getState() });
            if (message?.type === 'start') return sendResponse({ ok: true, state: await startProcess() });
            if (message?.type === 'stop') return sendResponse({ ok: true, state: await stopProcess() });
            return sendResponse({ ok: false, error: 'unknown_command' });
        } catch (e) {
            return sendResponse({ ok: false, error: String(e?.message || e) });
        }
    })();
    return true; // keep port open for async sendResponse
});

// Alarm handler: take screenshot and compute next trigger
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== 'sg_alarm') return;
    const s = await getState();
    if (!s.running) return;
    try {
        await takeScreenshot();
    } catch (err) {
        const errorMsg = err?.message || String(err);
        console.warn('ScreenGrabber background capture skipped/failed:', errorMsg);
        await pStorageSet({ [STORAGE_KEYS.lastError]: errorMsg });
    } finally {
        const nextTs = Date.now() + SCREENSHOT_INTERVAL_MINUTES * 60 * 1000;
        await pStorageSet({ [STORAGE_KEYS.nextTs]: nextTs });
        await sendStateUpdate();
    }
});

// Initialize defaults on install/update and re-attach alarm if needed
chrome.runtime.onInstalled.addListener(async () => {
    await pStorageRemove([STORAGE_KEYS.count, STORAGE_KEYS.lastTs, STORAGE_KEYS.nextTs, STORAGE_KEYS.lastError]);
    await pStorageSet({ [STORAGE_KEYS.running]: false });
});

// When the worker wakes up, ensure alarm is scheduled if running
(async function ensureAlarmOnStart() {
    try {
        const s = await getState();
        if (s.running) {
            const existingAlarm = await pAlarmGet('sg_alarm');
            if (!existingAlarm) {
                let delayInMinutes = SCREENSHOT_INTERVAL_MINUTES;
                if (s.nextTriggerTs && s.nextTriggerTs > Date.now()) {
                    delayInMinutes = Math.max(0.1, (s.nextTriggerTs - Date.now()) / (60 * 1000));
                }
                chrome.alarms.create('sg_alarm', {
                    delayInMinutes,
                    periodInMinutes: SCREENSHOT_INTERVAL_MINUTES
                });
                if (!s.nextTriggerTs) {
                    await pStorageSet({ [STORAGE_KEYS.nextTs]: Date.now() + SCREENSHOT_INTERVAL_MINUTES * 60 * 1000 });
                }
            }
        }
    } catch (_) { /* ignore */ }
})();