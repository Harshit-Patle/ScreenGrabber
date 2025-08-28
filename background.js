// Global interval for screenshots in minutes (change this value whenever you want)
// Single source of truth for the schedule; popup reads this via state updates.
const SCREENSHOT_INTERVAL_MINUTES = 5;

// Function to format date and time for the filename
function getFormattedDateTime() {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

// Function to take a screenshot and download it
async function takeScreenshot() {
    try {
        // Capture the visible part of the currently active tab
        const dataUrl = await chrome.tabs.captureVisibleTab(null, {
            format: 'png'
        });

        // Create the filename
        const filename = `Nifty_${getFormattedDateTime()}.png`;

        // Use the downloads API to save the file
        chrome.downloads.download({
            url: dataUrl,
            filename: filename,
            saveAs: false // Set to true if you want the user to choose the location
        });

        // Update the screenshot count (persisted in chrome.storage.local)
        const { screenshotCount = 0 } = await chrome.storage.local.get('screenshotCount');
        const newCount = screenshotCount + 1;
        await chrome.storage.local.set({ screenshotCount: newCount });

        // Send an update to the UI if it's open
        sendStateUpdate();

    } catch (error) {
        console.error("Failed to take screenshot:", error);
    }
}

// Function to send the current state to the popup
// Includes the intervalMinutes so the popup can display the default countdown correctly
async function sendStateUpdate() {
    const state = await chrome.storage.local.get(['isRunning', 'screenshotCount', 'nextScreenshotTime']);
    state.intervalMinutes = SCREENSHOT_INTERVAL_MINUTES;
    chrome.runtime.sendMessage({ command: 'updateUI', state }).catch(err => {
        // Ignore errors, which usually mean the popup is not open.
    });
}

// Listener for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        if (message.command === 'start') {
            await startProcess();
        } else if (message.command === 'stop') {
            await stopProcess();
        } else if (message.command === 'getState') {
            const state = await chrome.storage.local.get(['isRunning', 'screenshotCount', 'nextScreenshotTime']);
            state.intervalMinutes = SCREENSHOT_INTERVAL_MINUTES;
            sendResponse(state);
            return; // Keep the message channel open for async response
        }
        // Send an immediate UI update after start/stop
        sendStateUpdate();
    })();
    return true; // Indicates an async response
});

// Main start function
// - Marks the process as running
// - Takes an immediate screenshot
// - Schedules a repeating alarm based on SCREENSHOT_INTERVAL_MINUTES
async function startProcess() {
    // Set initial state and take the first screenshot immediately
    await chrome.storage.local.set({ isRunning: true, screenshotCount: 0 });
    await takeScreenshot(); // Take the first one right away

    // Create an alarm that will fire every 5 minutes
    const nextScreenshotTime = Date.now() + SCREENSHOT_INTERVAL_MINUTES * 60 * 1000;
    await chrome.storage.local.set({ nextScreenshotTime });
    chrome.alarms.create('screenshotAlarm', {
        delayInMinutes: SCREENSHOT_INTERVAL_MINUTES,
        periodInMinutes: SCREENSHOT_INTERVAL_MINUTES
    });
}

// Main stop function
// - Clears the screenshot alarm
// - Flags the process as stopped
async function stopProcess() {
    // Clear the alarm and reset the state
    await chrome.alarms.clear('screenshotAlarm');
    await chrome.storage.local.set({ isRunning: false, nextScreenshotTime: null });
}

// Listener for the alarm
// When the alarm fires, if still running, take a screenshot and compute the next trigger time
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'screenshotAlarm') {
        const { isRunning } = await chrome.storage.local.get('isRunning');
        if (isRunning) {
            await takeScreenshot();
            // Update the next screenshot time in storage
            const nextScreenshotTime = Date.now() + SCREENSHOT_INTERVAL_MINUTES * 60 * 1000;
            await chrome.storage.local.set({ nextScreenshotTime });
            sendStateUpdate();
        }
    }
});

// Clean up storage when the extension is installed or reloaded
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({
        isRunning: false,
        screenshotCount: 0,
        nextScreenshotTime: null
    });
});
