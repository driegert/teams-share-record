// Combines per-frame reports from detector.js into one verdict per tab and
// nags when recording and sharing disagree, or both are on but the mic is
// muted, for longer than the grace period.

const DEFAULTS = { enabled: true, graceSec: 45, notifyEverySec: 30 };
const FRESH_MS = 10_000; // ignore frames that haven't reported recently

// tabId -> { frames: { frameId: {state, ts} } }  (rebuilt within seconds if the worker restarts)
const tabs = new Map();

// Serialize work per tab so concurrent frame reports can't clobber each other's meta.
const queues = new Map();
function serial(tabId, fn) {
  const next = (queues.get(tabId) || Promise.resolve()).then(fn, fn);
  queues.set(tabId, next.catch(() => {}));
  return next;
}

async function settings() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
}

// Timers that must survive a service-worker restart live in storage.session.
async function getMeta(tabId) {
  const key = `tab:${tabId}`;
  return (await chrome.storage.session.get(key))[key] || {};
}
async function setMeta(tabId, meta) {
  await chrome.storage.session.set({ [`tab:${tabId}`]: meta });
}

function combine(tabId) {
  const now = Date.now();
  const s = { inMeeting: false, sharing: false, recording: false, muted: null, frames: [] };
  for (const [frameId, f] of Object.entries(tabs.get(tabId)?.frames || {})) {
    if (now - f.ts > FRESH_MS) continue;
    s.frames.push(Number(frameId));
    s.inMeeting ||= f.state.inMeeting;
    s.sharing ||= f.state.sharing;
    s.recording ||= f.state.recording;
    if (f.state.muted != null) s.muted ||= f.state.muted;
  }
  // "Recording" text outside a meeting (e.g. a chat about a recording) doesn't count.
  s.recording &&= s.inMeeting || s.sharing;
  s.problem =
    s.recording && !s.sharing ? "not-sharing"
    : s.sharing && !s.recording ? "not-recording"
    : s.sharing && s.recording && s.muted === true ? "muted"
    : null;
  s.message = {
    "not-sharing": "RECORDING, but you are NOT sharing your screen",
    "not-recording": "SHARING, but this meeting is NOT being recorded",
    muted: "Recording and sharing, but your MIC is MUTED",
  }[s.problem] || "";
  return s;
}

async function evaluate(tabId) {
  const cfg = await settings();
  const s = combine(tabId);
  const meta = await getMeta(tabId);
  const now = Date.now();

  // Restart the grace period whenever the problem changes (e.g. not-sharing -> muted).
  if (s.problem !== meta.problem) {
    meta.problem = s.problem;
    meta.problemSince = s.problem ? now : undefined;
  }

  const snoozed = (meta.snoozeUntil || 0) > now;
  const alert = cfg.enabled && !!s.problem && !snoozed && now - meta.problemSince >= cfg.graceSec * 1000;

  chrome.tabs.sendMessage(tabId, { type: "verdict", alert, message: s.message }, { frameId: 0 }).catch(() => {});

  if (alert) {
    if (now - (meta.lastNotified || 0) >= cfg.notifyEverySec * 1000) {
      meta.lastNotified = now;
      chrome.notifications.create(`nag:${tabId}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Teams: check share / record",
        message: s.message,
        priority: 2,
        requireInteraction: true,
      });
    }
  } else if (meta.lastNotified) {
    delete meta.lastNotified;
    chrome.notifications.clear(`nag:${tabId}`);
  }

  chrome.action.setBadgeText({ tabId, text: alert ? "!!" : s.sharing && s.recording && s.muted === false ? "OK" : "" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: alert ? "#d10000" : "#1a7f37" });

  await setMeta(tabId, meta);
  return { ...s, alert, snoozed, snoozeUntil: meta.snoozeUntil, problemSince: meta.problemSince, cfg };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = msg.tabId ?? sender.tab?.id;
  if (tabId == null) return;

  if (msg.type === "state") {
    if (!tabs.has(tabId)) tabs.set(tabId, { frames: {} });
    tabs.get(tabId).frames[sender.frameId] = { state: msg.state, ts: Date.now() };
    serial(tabId, () => evaluate(tabId));
  } else if (msg.type === "snooze") {
    serial(tabId, async () => {
      const meta = await getMeta(tabId);
      meta.snoozeUntil = msg.minutes ? Date.now() + msg.minutes * 60_000 : 0;
      await setMeta(tabId, meta);
      return evaluate(tabId);
    }).then(sendResponse);
    return true;
  } else if (msg.type === "status") {
    serial(tabId, () => evaluate(tabId)).then(sendResponse);
    return true;
  }
});

// Clicking the notification jumps to the Teams tab.
chrome.notifications.onClicked.addListener(async (id) => {
  const tabId = Number(id.split(":")[1]);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  chrome.tabs.update(tabId, { active: true });
  chrome.windows.update(tab.windowId, { focused: true });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabs.delete(tabId);
  queues.delete(tabId);
  chrome.storage.session.remove(`tab:${tabId}`);
  chrome.notifications.clear(`nag:${tabId}`);
});
