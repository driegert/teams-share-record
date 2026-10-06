# Share/Record Nag

![The nag banner in a Teams meeting](banner.gif)

Edge (or Chrome) extension for Teams on the web. During a meeting, if **recording is on but you are not sharing your screen** (or the other way round) for longer than a grace period, or you're **recording and sharing with your mic muted**, it:

- shows a flashing red/orange banner across the top of the Teams tab, with a Snooze button,
- flashes the tab title,
- sends a desktop notification and repeats it (default every 30 s) until the mismatch is fixed. Clicking the notification jumps to the Teams tab.

If both are on, or both are off, it stays quiet. Ordinary meetings that you don't record never trigger it.

## Install

1. Go to `edge://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose this folder.
2. Pin the extension (puzzle icon → eye icon) so its badge is visible: `!!` means it's nagging, `OK` means you're sharing and recording.
3. After editing any file, click **Reload** on the extension card, then reload the Teams tab.

## How it detects things

| State | How |
|---|---|
| Sharing | A visible "Stop sharing" / "Stop presenting" / "You're presenting" label. (The page's `getDisplayMedia` is also wrapped, but only reported as `captureLive` in the dump: Teams keeps the capture alive after you stop sharing, so it can't be trusted.) |
| Recording | Visible labels such as "Recording", "Recording and transcription started", "Stop recording". Messages in the chat panel are ignored. |
| Mic muted | The mic button (`#microphone-button`) labelled "Unmute". If the button can't be found, mute state is "unknown" and it never nags about the mic. |
| In a meeting | A visible "Leave" / "Hang up" button. Recording only counts while you're in a meeting or sharing. |

Text detection depends on Teams' wording. The patterns are at the top of `detector.js` (`PATTERNS`).

## First run: check it in a test meeting

1. Start a Teams meeting by yourself and let auto-record start.
2. Open the extension popup. It should show **In meeting: yes, Recording: yes, Sharing: no** and count down to the nag.
3. Share your screen. **Sharing** should flip to **yes** and the nag should clear.
4. If any row is wrong, click **Dump labels → Copy dump** and paste the result into a Claude session. It lists every visible share/record/leave label Teams is using, so the patterns can be fixed.

## Settings (popup)

- **Grace period** (default 45 s): how long a mismatch must last before nagging. This gives you time to start sharing after auto-record kicks in.
- **Notification repeat** (default 30 s).
- **Enabled** checkbox, and Snooze buttons (15 min in the popup, 5 min on the banner).

## Known limits

- Edge must be allowed to show notifications (GNOME Settings → Notifications → Microsoft Edge). The desktop notification is what reaches you when Edge is hidden behind your slides.
- Ending class: if you stop sharing before you hang up, it nags until you leave. That's expected.

## Privacy

Everything runs locally in your browser. The extension reads the Teams page only to detect sharing, recording and mute state; it sends nothing anywhere. The **Dump labels** output can include names from your meeting, so check it before posting it in an issue.

## License

MIT, see [LICENSE](LICENSE). Not affiliated with or endorsed by Microsoft.
