// ScreenGrabber background (MV3 service worker)
// Cross-browser: uses tabs.captureTab in Firefox, captureVisibleTab in Chromium.

// Centralized configuration & keys
const CONFIG = {
    INTERVAL_MINUTES: 5,
    ALARM_NAME: 'sg_alarm',
    DOWNLOAD_SUBFOLDER: 'ScreenGrabber'
};

const STORAGE_KEYS = {
    running: 'sg_running',
    count: 'sg_count',
    lastTs: 'sg_last_ts',
    nextTs: 'sg_next_ts',
    lastError: 'sg_last_error'
};

const MSG_TYPES = {
    GET_STATE: 'getState',
    START: 'start',
    STOP: 'stop',
    STATE_UPDATE: 'state'
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

// Build a serializable state object for the popup
async function getState() {
    const result = await chrome.storage.local.get([
        STORAGE_KEYS.running,
        STORAGE_KEYS.count,
        STORAGE_KEYS.lastTs,
        STORAGE_KEYS.nextTs,
        STORAGE_KEYS.lastError
    ]);

    return {
        running: Boolean(result[STORAGE_KEYS.running]),
        screenshotCount: Number(result[STORAGE_KEYS.count] || 0),
        lastScreenshotTs: result[STORAGE_KEYS.lastTs] || null,
        nextTriggerTs: result[STORAGE_KEYS.nextTs] || null,
        intervalMinutes: CONFIG.INTERVAL_MINUTES,
        lastError: result[STORAGE_KEYS.lastError] || null
    };
}

// Notify any open UI about state changes (best-effort)
async function sendStateUpdate() {
    try {
        const state = await getState();
        await chrome.runtime.sendMessage({ type: MSG_TYPES.STATE_UPDATE, state });
    } catch (_) {
        // ignore if no active popup listener
    }
}

// Cross-browser capture of the active tab as PNG data URL
async function captureActiveTabPng() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const active = tabs[0];
    if (!active) throw new Error('No active tab found');
    if (active.url && isRestrictedUrl(active.url)) {
        throw new Error(`Cannot capture restricted page (${active.url.split('/')[0]}//...)`);
    }
    if (typeof chrome.tabs.captureTab === 'function') {
        // Firefox prefers captureTab
        return await chrome.tabs.captureTab(active.id, { format: 'png' });
    }
    // Chromium path
    return await chrome.tabs.captureVisibleTab(active.windowId, { format: 'png' });
}

// Take a screenshot and download it, update counters and timestamps
async function takeScreenshot() {
    const dataUrl = await captureActiveTabPng();
    const filename = `${CONFIG.DOWNLOAD_SUBFOLDER}/ScreenGrabber_${getFormattedDateTime()}.png`;
    await chrome.downloads.download({ url: dataUrl, filename, conflictAction: 'uniquify', saveAs: false });
    const now = Date.now();
    const s = await getState();
    const count = (s.screenshotCount || 0) + 1;
    await chrome.storage.local.set({
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
        const nextTs = Date.now() + CONFIG.INTERVAL_MINUTES * 60 * 1000;
        await chrome.storage.local.set({
            [STORAGE_KEYS.running]: true,
            [STORAGE_KEYS.nextTs]: nextTs,
            [STORAGE_KEYS.lastError]: null
        });
        await chrome.alarms.create(CONFIG.ALARM_NAME, {
            delayInMinutes: CONFIG.INTERVAL_MINUTES,
            periodInMinutes: CONFIG.INTERVAL_MINUTES
        });
        await sendStateUpdate();
        return await getState();
    } catch (err) {
        const errorMsg = err?.message || String(err);
        await chrome.alarms.clear(CONFIG.ALARM_NAME);
        await chrome.storage.local.set({
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
    await chrome.alarms.clear(CONFIG.ALARM_NAME);
    await chrome.storage.local.set({
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
            if (message?.type === MSG_TYPES.GET_STATE) return sendResponse({ ok: true, state: await getState() });
            if (message?.type === MSG_TYPES.START) return sendResponse({ ok: true, state: await startProcess() });
            if (message?.type === MSG_TYPES.STOP) return sendResponse({ ok: true, state: await stopProcess() });
            return sendResponse({ ok: false, error: 'unknown_command' });
        } catch (e) {
            return sendResponse({ ok: false, error: String(e?.message || e) });
        }
    })();
    return true; // keep port open for async sendResponse
});

// Alarm handler: take screenshot and compute next trigger
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== CONFIG.ALARM_NAME) return;
    const s = await getState();
    if (!s.running) return;
    try {
        await takeScreenshot();
    } catch (err) {
        const errorMsg = err?.message || String(err);
        console.warn('ScreenGrabber background capture skipped/failed:', errorMsg);
        await chrome.storage.local.set({ [STORAGE_KEYS.lastError]: errorMsg });
    } finally {
        const nextTs = Date.now() + CONFIG.INTERVAL_MINUTES * 60 * 1000;
        await chrome.storage.local.set({ [STORAGE_KEYS.nextTs]: nextTs });
        await sendStateUpdate();
    }
});

// Initialize defaults on install/update
chrome.runtime.onInstalled.addListener(async () => {
    await chrome.storage.local.remove([
        STORAGE_KEYS.count,
        STORAGE_KEYS.lastTs,
        STORAGE_KEYS.nextTs,
        STORAGE_KEYS.lastError
    ]);
    await chrome.storage.local.set({ [STORAGE_KEYS.running]: false });
});

// When the worker wakes up, ensure alarm is scheduled if running without resetting timer
(async function ensureAlarmOnStart() {
    try {
        const s = await getState();
        if (s.running) {
            const existingAlarm = await chrome.alarms.get(CONFIG.ALARM_NAME);
            if (!existingAlarm) {
                let delayInMinutes = CONFIG.INTERVAL_MINUTES;
                if (s.nextTriggerTs && s.nextTriggerTs > Date.now()) {
                    delayInMinutes = Math.max(0.1, (s.nextTriggerTs - Date.now()) / (60 * 1000));
                }
                await chrome.alarms.create(CONFIG.ALARM_NAME, {
                    delayInMinutes,
                    periodInMinutes: CONFIG.INTERVAL_MINUTES
                });
                if (!s.nextTriggerTs) {
                    await chrome.storage.local.set({ [STORAGE_KEYS.nextTs]: Date.now() + CONFIG.INTERVAL_MINUTES * 60 * 1000 });
                }
            }
        }
    } catch (_) { /* ignore */ }
})();