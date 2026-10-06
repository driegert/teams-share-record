const DEFAULTS = { enabled: true, graceSec: 45, notifyEverySec: 30 };
const $ = (id) => document.getElementById(id);
let tabId = null;

function yn(v) {
  return `<span class="${v ? "yes" : "no"}">${v ? "yes" : "no"}</span>`;
}

function render(s) {
  if (!s || !s.frames?.length) {
    $("status").textContent = "No Teams frames reporting in this tab.";
    return;
  }
  const verdict = s.alert
    ? `<span class="alert">NAGGING: ${s.message}</span>`
    : s.snoozed
      ? `Snoozed until ${new Date(s.snoozeUntil).toLocaleTimeString()}`
      : s.problem
        ? `${s.message}: nagging in ${Math.max(0, Math.ceil(s.cfg.graceSec - (Date.now() - s.problemSince) / 1000))} s`
        : "All good";
  $("status").innerHTML = `
    <table>
      <tr><td>In meeting</td><td>${yn(s.inMeeting)}</td></tr>
      <tr><td>Sharing</td><td>${yn(s.sharing)}</td></tr>
      <tr><td>Recording</td><td>${yn(s.recording)}</td></tr>
      <tr><td>Mic muted</td><td>${s.muted == null ? '<span class="no">unknown</span>' : yn(s.muted)}</td></tr>
      <tr><td>Frames reporting</td><td>${s.frames.length}</td></tr>
    </table>
    <div>${verdict}</div>`;
}

async function refresh() {
  if (tabId == null) return;
  render(await chrome.runtime.sendMessage({ type: "status", tabId }).catch(() => null));
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && /^https:\/\/teams\.(microsoft\.com|cloud\.microsoft)\//.test(tab.url || "")) tabId = tab.id;

  const cfg = await chrome.storage.sync.get(DEFAULTS);
  $("enabled").checked = cfg.enabled;
  $("graceSec").value = cfg.graceSec;
  $("notifyEverySec").value = cfg.notifyEverySec;
  $("enabled").onchange = (e) => chrome.storage.sync.set({ enabled: e.target.checked });
  $("graceSec").onchange = (e) => chrome.storage.sync.set({ graceSec: Math.max(0, +e.target.value) });
  $("notifyEverySec").onchange = (e) => chrome.storage.sync.set({ notifyEverySec: Math.max(5, +e.target.value) });

  $("snooze").onclick = async () => render(await chrome.runtime.sendMessage({ type: "snooze", tabId, minutes: 15 }));
  $("unsnooze").onclick = async () => render(await chrome.runtime.sendMessage({ type: "snooze", tabId, minutes: 0 }));

  $("dump").onclick = async () => {
    const s = await chrome.runtime.sendMessage({ type: "status", tabId });
    const results = await Promise.all(
      (s?.frames || []).map((frameId) =>
        chrome.tabs.sendMessage(tabId, { type: "dump" }, { frameId }).catch((e) => ({ frameId, error: String(e) }))
      )
    );
    $("out").style.display = "block";
    $("out").value = JSON.stringify(results, null, 1);
    $("copy").hidden = false;
  };
  $("copy").onclick = () => navigator.clipboard.writeText($("out").value);

  if (tabId == null) {
    for (const id of ["snooze", "unsnooze", "dump"]) $(id).disabled = true;
    return;
  }
  refresh();
  setInterval(refresh, 1000);
}

init();
