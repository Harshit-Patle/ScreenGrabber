/**
 * Popup script for the Screenshot Extension.
 * - Kept external (no inline <script>) to comply with MV3 CSP: "script-src 'self'".
 * - Communicates with the background service worker via chrome.runtime messaging.
 * - Displays current status, countdown to next screenshot, and total screenshots taken.
 */
// Handles popup interactions and UI updates, kept external to satisfy MV3 CSP
(function () {
    const isExtensionContext = () => typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage;

    // Cache DOM elements once
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const countdownEl = document.getElementById('countdown');
    const countEl = document.getElementById('screenshotCount');

    let countdownInterval;

    /**
     * Convert seconds to mm:ss string.
     * @param {number} seconds
     * @returns {string}
     */
    function formatTime(seconds) {
        const min = Math.floor(seconds / 60);
        const sec = seconds % 60;
        return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    }

    /**
     * Update all UI elements based on the state reported by background.
     * @param {{isRunning?: boolean, screenshotCount?: number, nextScreenshotTime?: number, intervalMinutes?: number}} state
     */
    function updateUI(state) {
        countEl.textContent = state.screenshotCount || 0;
        if (state.isRunning && state.nextScreenshotTime) {
            startButton.disabled = true;
            stopButton.disabled = false;
            updateCountdown(state.nextScreenshotTime);
        } else {
            startButton.disabled = false;
            stopButton.disabled = true;
            if (countdownInterval) clearInterval(countdownInterval);
            // Default countdown display uses intervalMinutes from background (single source of truth)
            const mins = Number(state.intervalMinutes || 5);
            const defaultSeconds = Math.max(0, Math.floor(mins * 60));
            const min = Math.floor(defaultSeconds / 60).toString().padStart(2, '0');
            const sec = (defaultSeconds % 60).toString().padStart(2, '0');
            countdownEl.textContent = `${min}:${sec}`;
        }
    }

    /**
     * Start/refresh the 1s interval to display the countdown until next screenshot time.
     * @param {number} nextTime - timestamp (ms) when the next screenshot will be taken
     */
    function updateCountdown(nextTime) {
        if (countdownInterval) clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            const remaining = Math.max(0, Math.floor((nextTime - Date.now()) / 1000));
            countdownEl.textContent = formatTime(remaining);
            if (remaining <= 0) {
                clearInterval(countdownInterval);
            }
        }, 1000);
    }

    startButton.addEventListener('click', () => {
        // Ask the background service worker to start: it will take an immediate screenshot and schedule the alarm.
        if (isExtensionContext()) {
            chrome.runtime.sendMessage({ command: 'start' });
        }
    });

    stopButton.addEventListener('click', () => {
        // Ask the background service worker to stop and clear the alarm.
        if (isExtensionContext()) {
            chrome.runtime.sendMessage({ command: 'stop' });
        }
    });

    if (isExtensionContext() && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((message) => {
            if (message.command === 'updateUI') {
                // Background pushes state updates here (e.g., after a screenshot or when toggling start/stop)
                updateUI(message.state);
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (isExtensionContext()) {
            // Request the latest state from background when the popup opens
            chrome.runtime.sendMessage({ command: 'getState' }, (response) => {
                if (chrome.runtime.lastError) {
                    updateUI({ isRunning: false, screenshotCount: 0 });
                } else {
                    updateUI(response);
                }
            });
        } else {
            // Fallback for non-extension environments
            updateUI({ isRunning: false, screenshotCount: 0 });
        }
    });
})();
