// ScreenGrabber Popup UI Controller
// Compliant with MV3 Content Security Policy (no inline scripts)

const MSG_TYPES = {
  GET_STATE: 'getState',
  START: 'start',
  STOP: 'stop',
  STATE_UPDATE: 'state'
};

const els = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
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
  const isRunning = Boolean(state.running);

  // Status badge & indicator
  els.statusText.textContent = isRunning ? 'Running' : 'Idle';
  els.statusDot.classList.toggle('active', isRunning);

  // Button state management
  els.start.disabled = isRunning;
  els.stop.disabled = !isRunning;

  // Counter
  els.count.textContent = String(state.screenshotCount ?? 0);

  // Countdown timer
  let remainingMs;
  if (isRunning && state.nextTriggerTs) {
    remainingMs = Math.max(0, state.nextTriggerTs - Date.now());
  } else {
    remainingMs = Math.floor((state.intervalMinutes ?? 5) * 60 * 1000);
  }
  els.countdown.textContent = fmtMMSS(remainingMs);

  // Error banner
  showError(state.lastError);
}

async function requestState() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: MSG_TYPES.GET_STATE });
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

// Listen for background state broadcasts
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === MSG_TYPES.STATE_UPDATE && msg.state) {
    state = { ...state, ...msg.state };
    render();
  }
});

els.start.addEventListener('click', async () => {
  showError(null);
  els.start.disabled = true;
  try {
    const resp = await chrome.runtime.sendMessage({ type: MSG_TYPES.START });
    if (resp?.ok && resp.state) {
      state = { ...state, ...resp.state };
      render();
    } else if (resp?.error) {
      showError(resp.error);
      els.start.disabled = false;
    }
  } catch (err) {
    showError(err?.message || 'Failed to start capture session');
    els.start.disabled = false;
  }
});

els.stop.addEventListener('click', async () => {
  els.stop.disabled = true;
  try {
    const resp = await chrome.runtime.sendMessage({ type: MSG_TYPES.STOP });
    if (resp?.ok && resp.state) {
      state = { ...state, ...resp.state };
      render();
    } else if (resp?.error) {
      showError(resp.error);
      els.stop.disabled = false;
    }
  } catch (err) {
    showError(err?.message || 'Failed to stop capture session');
    els.stop.disabled = false;
  }
});

// Initial load + 1s ticker for live countdown rendering
requestState();
const timer = setInterval(render, 1000);
window.addEventListener('unload', () => clearInterval(timer));