// ScreenGrabber background (MV3 service worker)
// Cross-browser: uses tabs.captureTab in Firefox, captureVisibleTab in Chromium.

// Centralized configuration & keys
const CONFIG = {
    DEFAULT_INTERVAL_MINUTES: 5,
    ALARM_NAME: 'sg_alarm',
    DOWNLOAD_SUBFOLDER: 'ScreenGrabber'
};

const STORAGE_KEYS = {
    running: 'sg_running',
    count: 'sg_count',
    lastTs: 'sg_last_ts',
    nextTs: 'sg_next_ts',
    lastError: 'sg_last_error',
    interval: 'sg_interval'
};

const MSG_TYPES = {
    GET_STATE: 'getState',
    START: 'start',
    STOP: 'stop',
    SET_INTERVAL: 'setInterval',
    STATE_UPDATE: 'state'
};

// Utility: sanitize interval in minutes (min: 1 min, max: 1440 mins / 24 hrs)
function sanitizeInterval(val) {
    const num = Number(val);
    if (!Number.isFinite(num) || num < 1) return CONFIG.DEFAULT_INTERVAL_MINUTES;
    return Math.min(1440, Math.round(num));
}

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
        'edge-extension://',
        'about:',
        'devtools://',
        'view-source:',
        'https://chromewebstore.google.com',
        'https://chrome.google.com/webstore',
        'https://microsoftedge.microsoft.com/addons'
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
        STORAGE_KEYS.lastError,
        STORAGE_KEYS.interval
    ]);

    const intervalMinutes = sanitizeInterval(result[STORAGE_KEYS.interval]);

    return {
        running: Boolean(result[STORAGE_KEYS.running]),
        screenshotCount: Number(result[STORAGE_KEYS.count] || 0),
        lastScreenshotTs: result[STORAGE_KEYS.lastTs] || null,
        nextTriggerTs: result[STORAGE_KEYS.nextTs] || null,
        intervalMinutes,
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

// Update user-configured capture interval
async function setIntervalMinutes(rawMinutes) {
    const intervalMinutes = sanitizeInterval(rawMinutes);
    await chrome.storage.local.set({ [STORAGE_KEYS.interval]: intervalMinutes });
    await sendStateUpdate();
    return getState();
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
async function startProcess(customInterval) {
    const s = await getState();
    if (s.running) return s;

    const intervalMinutes = customInterval ? sanitizeInterval(customInterval) : s.intervalMinutes;

    try {
        await takeScreenshot();
        const nextTs = Date.now() + intervalMinutes * 60 * 1000;
        await chrome.storage.local.set({
            [STORAGE_KEYS.running]: true,
            [STORAGE_KEYS.nextTs]: nextTs,
            [STORAGE_KEYS.interval]: intervalMinutes,
            [STORAGE_KEYS.lastError]: null
        });
        await chrome.alarms.create(CONFIG.ALARM_NAME, {
            delayInMinutes: intervalMinutes,
            periodInMinutes: intervalMinutes
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
            if (message?.type === MSG_TYPES.START) return sendResponse({ ok: true, state: await startProcess(message?.intervalMinutes) });
            if (message?.type === MSG_TYPES.STOP) return sendResponse({ ok: true, state: await stopProcess() });
            if (message?.type === MSG_TYPES.SET_INTERVAL) return sendResponse({ ok: true, state: await setIntervalMinutes(message?.intervalMinutes) });
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
        const nextTs = Date.now() + s.intervalMinutes * 60 * 1000;
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
    await chrome.storage.local.set({
        [STORAGE_KEYS.running]: false,
        [STORAGE_KEYS.interval]: CONFIG.DEFAULT_INTERVAL_MINUTES
    });
});

// When the worker wakes up, ensure alarm is scheduled if running without resetting timer
(async function ensureAlarmOnStart() {
    try {
        const s = await getState();
        if (s.running) {
            const existingAlarm = await chrome.alarms.get(CONFIG.ALARM_NAME);
            if (!existingAlarm) {
                let delayInMinutes = s.intervalMinutes;
                if (s.nextTriggerTs && s.nextTriggerTs > Date.now()) {
                    delayInMinutes = Math.max(0.1, (s.nextTriggerTs - Date.now()) / (60 * 1000));
                }
                await chrome.alarms.create(CONFIG.ALARM_NAME, {
                    delayInMinutes,
                    periodInMinutes: s.intervalMinutes
                });
                if (!s.nextTriggerTs) {
                    await chrome.storage.local.set({ [STORAGE_KEYS.nextTs]: Date.now() + s.intervalMinutes * 60 * 1000 });
                }
            }
        }
    } catch (_) { /* ignore */ }
})();