// Popup UI (no inline scripts to satisfy MV3 CSP)
// Shows running status, countdown, and count. Sends start/stop to background.

const els = {
  status: document.getElementById('status'),
  countdown: document.getElementById('countdown'),
  count: document.getElementById('screenshotCount'),
  start: document.getElementById('startButton'),
  stop: document.getElementById('stopButton'),
  error: document.getElementById('errorMessage')
};

let state = {
  running: false,
  screenshotCount: 0,
  nextTriggerTs: null,
  intervalMinutes: 5,
  lastError: null
};

function fmtMMSS(ms) {
  if (ms == null || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function showError(msg) {
  if (!els.error) return;
  if (msg) {
    els.error.textContent = msg;
    els.error.style.display = 'block';
  } else {
    els.error.textContent = '';
    els.error.style.display = 'none';
  }
}

function render() {
  els.status.textContent = state.running ? 'Running' : 'Idle';
  els.count.textContent = String(state.screenshotCount ?? 0);

  let remainingMs;
  if (state.running && state.nextTriggerTs) {
    remainingMs = Math.max(0, state.nextTriggerTs - Date.now());
  } else {
    remainingMs = Math.floor((state.intervalMinutes ?? 5) * 60 * 1000);
  }
  els.countdown.textContent = fmtMMSS(remainingMs);
  showError(state.lastError);
}

async function requestState() {
  try {
    const resp = await new Promise((res) => chrome.runtime.sendMessage({ type: 'getState' }, res));
    if (resp?.ok && resp.state) {
      state = { ...state, ...resp.state };
      render();
    } else if (resp?.error) {
      showError(resp.error);
    }
  } catch (err) {
    showError(err?.message || 'Failed to connect to background worker');
  }
}

// Listen for background-pushed updates (best-effort)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'state' && msg.state) {
    state = { ...state, ...msg.state };
    render();
  }
});

els.start.addEventListener('click', async () => {
  showError(null);
  try {
    const resp = await new Promise((res) => chrome.runtime.sendMessage({ type: 'start' }, res));
    if (resp?.ok && resp.state) {
      state = { ...state, ...resp.state };
      render();
    } else if (resp?.error) {
      showError(resp.error);
    }
  } catch (err) {
    showError(err?.message || 'Failed to start capture session');
  }
});

els.stop.addEventListener('click', async () => {
  try {
    const resp = await new Promise((res) => chrome.runtime.sendMessage({ type: 'stop' }, res));
    if (resp?.ok && resp.state) {
      state = { ...state, ...resp.state };
      render();
    } else if (resp?.error) {
      showError(resp.error);
    }
  } catch (err) {
    showError(err?.message || 'Failed to stop capture session');
  }
});

// Initial load + 1s ticker for countdown display
requestState();
const timer = setInterval(render, 1000);
window.addEventListener('unload', () => clearInterval(timer));