# ScreenGrabber 📸

> Automated periodic screenshot capture browser extension for Manifest V3 (MV3).

**ScreenGrabber** automatically takes high-quality PNG screenshots of your active browser tab at customizable time intervals (1m, 2m, 5m, 10m, 15m, 30m, 1hr) and neatly organizes them into a dedicated `Downloads/ScreenGrabber/` folder.

---

## ✨ Features

- ⏱️ **Customizable Intervals:** Choose between 1 min, 2 mins, 5 mins (default), 10 mins, 15 mins, 30 mins, or 1 hour.
- ⚡ **Instant & Periodic Capture:** Takes an immediate snapshot upon starting, followed by scheduled automated captures.
- 📁 **Subfolder Isolation:** Saves all files as timestamped images in `Downloads/ScreenGrabber/ScreenGrabber_YYYY-MM-DD_HH-mm-ss.png` with automatic deduplication.
- 📊 **Real-time Live Countdown & Counter:** Live ticking countdown showing time remaining until next capture and total screenshots taken.
- 🛡️ **Robust Edge & MV3 Lifecycle Protection:** Service worker wakeups do not reset alarm countdowns; state transitions are atomic with graceful fallback on restricted browser pages (`edge://`, `chrome://`, `about:`).
- 🎨 **Adaptive Design & Accessibility:** Modern UI with native support for system Light and Dark modes (`prefers-color-scheme`), animated status badge, and ARIA screen reader support.
- 🌐 **Cross-Browser Compatible:** Tested and ready for Microsoft Edge, Google Chrome, Brave, Opera, and Mozilla Firefox.

---

## 🚀 Installation

### Microsoft Edge / Google Chrome / Brave
1. Clone or download this repository.
2. Open your browser and navigate to the Extensions page:
   - **Edge:** `edge://extensions`
   - **Chrome:** `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right / sidebar).
4. Click **Load unpacked** and select the extension root directory (`Screenshot Extension`).
5. Pin **ScreenGrabber** to your browser toolbar for quick access.

### Mozilla Firefox
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `manifest.json` from the repository root.

---

## 🛠️ Usage

1. Click the **ScreenGrabber** icon in your browser toolbar to open the popup.
2. Select your desired **Capture Interval** (e.g., 5 mins).
3. Click **Start**:
   - An initial screenshot is taken immediately.
   - The status changes to **Running** (with a pulsing green indicator).
   - The countdown starts ticking toward the next capture.
4. Click **Stop** anytime to pause automated captures.

---

## 📦 Store Packaging & Distribution

To create a clean `.zip` archive ready for upload to the **Microsoft Edge Add-ons Store** or **Chrome Web Store**:

```bash
npm run package
```

This generates `screengrabber-v1.1.0.zip` excluding git repositories, development configs, and temporary files.

---

## 🔒 Permissions & Security Rationale

| Permission | Purpose |
| :--- | :--- |
| `activeTab` & `tabs` | Identifies the active browser tab window and URL for screenshot capture. |
| `storage` | Persists session running state, screenshot count, timestamps, and interval preferences locally across browser restarts. |
| `alarms` | Schedules periodic background captures reliably using Manifest V3 alarms. |
| `downloads` | Saves captured PNG images directly into `Downloads/ScreenGrabber/`. |
| `host_permissions` (`<all_urls>`) | Enables periodic background capture of web pages even after the popup is closed. |

*Note: ScreenGrabber operates 100% locally on your machine. No screenshots, URLs, or personal data are ever transmitted to external servers.*

---

## 📄 License

MIT License © 2025–2026 Harshit Patle. See [LICENCE](LICENCE) for details.
