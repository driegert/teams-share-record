// Content script, injected into every Teams frame. It reads meeting state from
// the page and reports it to background.js, which combines all frames and
// decides whether to nag. The top frame also draws the flashing banner.

// Teams changes its markup often. When detection breaks, run "Dump labels" from
// the toolbar popup during a test meeting and fix these patterns.
const PATTERNS = {
  inMeeting: [/^(leave|hang up)\b/i],
  sharing: [/\bstop (sharing|presenting)\b/i, /\byou('re| are) (sharing|presenting)\b/i],
  recording: [
    /^recording\b/i,
    /\brecording (and transcription )?(has )?started\b/i,
    /\b(is being|are being) recorded\b/i,
    /\bstop recording\b/i,
  ],
};
// The mic button's label names the action it would take: "Unmute" means you're muted.
// Prefer the button itself. The fallback needs the Ctrl+Shift+M shortcut in the
// label: only your own toolbar button has it, not "Unmute" in the participant list.
const MIC_BUTTON = '#microphone-button, [data-tid="toggle-mute"], [data-tid="microphone-button"]';
const MIC_LABEL = /^(un)?mute\b.*ctrl\s*\+\s*shift\s*\+\s*m/i;
// Don't let chat messages ("Recording has started" from an hour ago) count.
const IGNORE_INSIDE = '[role="log"], [role="feed"], [data-tid*="message"], [data-tid*="chat-pane"]';
const DUMP_PATTERN = /share|sharing|present|record|transcri|leave|hang ?up|mute|mic/i;

let hookSharing = false;
window.addEventListener("message", (e) => {
  if (e.source === window && e.data?.__shareRecord === "share") hookSharing = !!e.data.sharing;
});

function labelOf(el) {
  const aria = el.getAttribute("aria-label") || el.getAttribute("title");
  if (aria) return aria.trim();
  const text = el.childElementCount === 0 ? el.textContent.trim() : "";
  return text.length > 0 && text.length <= 60 ? text : "";
}

function visible(el) {
  return el.getClientRects().length > 0;
}

function candidates() {
  return document.querySelectorAll(
    '[aria-label], [title], [role="status"], [role="alert"], [role="timer"], button, span'
  );
}

function scan() {
  const found = { inMeeting: false, sharing: false, recording: false };
  for (const el of candidates()) {
    const label = labelOf(el);
    if (!label || !visible(el)) continue;
    for (const key of Object.keys(found)) {
      if (found[key]) continue;
      if (key === "recording" && el.closest(IGNORE_INSIDE)) continue;
      if (PATTERNS[key].some((re) => re.test(label))) found[key] = true;
    }
  }
  // The capture hook isn't trusted for the verdict: Teams keeps the capture
  // track alive after "Stop sharing", so it reports false positives. It stays
  // in the dump as a diagnostic.
  return {
    inMeeting: found.inMeeting,
    sharing: found.sharing,
    recording: found.recording,
    // null = couldn't find the mic button; never nag on a guess.
    muted: micMuted(),
  };
}

function micMuted() {
  let el = [...document.querySelectorAll(MIC_BUTTON)].find(visible);
  if (!el) {
    el = [...document.querySelectorAll("button[aria-label], button[title]")].find(
      (b) => visible(b) && MIC_LABEL.test(labelOf(b)) && !b.closest(IGNORE_INSIDE)
    );
  }
  const label = el ? labelOf(el) : "";
  if (/^unmute\b/i.test(label)) return true;
  if (/^mute\b/i.test(label)) return false;
  return null;
}

function dump() {
  const out = [];
  for (const el of candidates()) {
    const label = labelOf(el);
    if (!label || !DUMP_PATTERN.test(label)) continue;
    out.push({
      label,
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      tid: el.getAttribute("data-tid") || undefined,
      role: el.getAttribute("role") || undefined,
      pressed: el.getAttribute("aria-pressed") || undefined,
      visible: visible(el),
      inChat: !!el.closest(IGNORE_INSIDE),
    });
  }
  return { url: location.href, top: window === window.top, captureLive: hookSharing, scan: scan(), elements: out };
}

let last = "";
function report(force) {
  if (!document.documentElement) return;
  const state = scan();
  const key = JSON.stringify(state);
  if (!force && key === last) return;
  last = key;
  chrome.runtime.sendMessage({ type: "state", state }).catch(() => {});
}
// Re-send every few seconds even if nothing changed: it keeps background.js
// awake and lets it re-fire notifications.
setInterval(() => report(true), 3000);
setInterval(() => report(false), 1000);

// ---- Banner (top frame only) ----

let banner = null;
let titleTimer = null;
let savedTitle = null;

function showBanner(message) {
  if (!banner) {
    const host = document.createElement("div");
    host.style.cssText = "all: initial; position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;";
    const root = host.attachShadow({ mode: "closed" });
    // Built with DOM calls rather than innerHTML: Teams may enforce Trusted Types.
    const style = document.createElement("style");
    style.textContent = `
      .bar { display: flex; align-items: center; justify-content: center; gap: 16px;
             padding: 14px 16px; font: 700 20px/1.2 system-ui, sans-serif; color: #fff;
             animation: flash 0.8s steps(1) infinite; box-shadow: 0 4px 16px rgba(0,0,0,.5); }
      @keyframes flash { 0% { background: #d10000; } 50% { background: #ff8c00; } }
      button { font: 600 14px system-ui, sans-serif; padding: 6px 12px; border-radius: 6px;
               border: 2px solid #fff; background: transparent; color: #fff; cursor: pointer; }`;
    const bar = document.createElement("div");
    bar.className = "bar";
    const msg = document.createElement("span");
    const snooze = document.createElement("button");
    snooze.textContent = "Snooze 5 min";
    snooze.addEventListener("click", () =>
      chrome.runtime.sendMessage({ type: "snooze", minutes: 5 }).catch(() => {})
    );
    bar.append(msg, snooze);
    root.append(style, bar);
    banner = { host, msg };
  }
  banner.msg.textContent = message;
  if (!banner.host.isConnected) document.documentElement.appendChild(banner.host);

  if (!titleTimer) {
    savedTitle = document.title;
    let on = false;
    titleTimer = setInterval(() => {
      on = !on;
      document.title = on ? "⚠ CHECK SHARE/RECORD ⚠" : savedTitle;
    }, 1000);
  }
}

function hideBanner() {
  banner?.host.remove();
  if (titleTimer) {
    clearInterval(titleTimer);
    titleTimer = null;
    document.title = savedTitle;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "verdict" && window === window.top) {
    msg.alert ? showBanner(msg.message) : hideBanner();
  } else if (msg.type === "dump") {
    sendResponse(dump());
  }
});
