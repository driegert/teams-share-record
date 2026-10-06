// Runs in the page's own JS world (not the extension's isolated one) so it can
// wrap navigator.mediaDevices.getDisplayMedia. Any live screen-capture track
// means you're sharing, no matter what Teams' buttons look like this month.
(() => {
  const md = navigator.mediaDevices;
  if (!md || typeof md.getDisplayMedia !== "function" || md.__shareRecordHooked) return;
  Object.defineProperty(md, "__shareRecordHooked", { value: true });

  const tracks = new Set();
  const isSharing = () => {
    for (const t of tracks) {
      if (t.readyState === "live") return true;
      tracks.delete(t);
    }
    return false;
  };
  const announce = () =>
    window.postMessage({ __shareRecord: "share", sharing: isSharing() }, "/");

  const original = md.getDisplayMedia.bind(md);
  md.getDisplayMedia = async function (...args) {
    const stream = await original(...args);
    for (const t of stream.getVideoTracks()) {
      tracks.add(t);
      t.addEventListener("ended", announce);
    }
    announce();
    return stream;
  };

  // track.stop() doesn't fire "ended", so poll as well.
  setInterval(announce, 2000);
})();
