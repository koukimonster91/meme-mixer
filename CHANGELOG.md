# Changelog

## 1.0.0 (2026-11-20)

### Added
- **Windows installer and tray app (`MemeMixer.exe`):** run it once to install. It downloads Node.js automatically, adds shortcuts, and runs Meme Mixer in the taskbar tray. Right-click the tray icon for: Open, Run when Windows starts, Check for updates, Open log folder, Exit.
- **Automatic updates from GitHub releases:** one click downloads, verifies and installs the new version, then restarts. Settings and scenes are kept.
- **Uninstall** from Windows Settings → Apps.
- The Settings page shows the version number.
- New fixes and features (also 2026-11-20):
  - fader values and VU meters now fit inside the strips on phones;
  - phone faders respond reliably (no stalls or pull-to-refresh);
  - Tesira network scan and auto-connect;
  - phone QR code.

## Earlier on 2026-11-20

### Added
- **QR code for phones:** Settings → Phone & tablet access shows a QR code for each network address. Scan it with a phone camera to open the mixer. It's generated locally (`public/qr.js`), so it works without internet.
- **Tesira network scan:** a **Scan network** button in Settings → Tesira connection lists every Tesira found on this PC's local network, with a **Connect** button for each.
- **Auto-connect:** a switch, on by default. If the Tesira doesn't answer at the saved address for about 8 seconds, the app scans the network and switches to the Tesira it finds. It only switches when it finds exactly one; if there are more, the log asks you to pick one. While offline, it scans again at most once a minute.

### Fixed
- **Phone faders moved when scrolling sideways:** a tap or a sideways swipe on a fader no longer changes its level. Only an up/down drag does, and the fader moves from its current position rather than jumping to where your finger landed. Matrix page cells work the same way.
- **Phone faders stalled or set off pull-to-refresh:** a vertical drag now takes over the whole touch on its first movement, so the browser can't take over partway through. Pull-to-refresh is turned off; the app updates live, so it isn't needed.
- **Phone strips overflowed:** fader scales, value boxes and VU meters now fit inside their strips on phone screens.

### Docs
- README: a troubleshooting note for when one phone browser says "This site can't be reached" but another browser works. The fix is to allow that browser's local network access in the phone's settings (Android: Nearby devices / Local network permission; iPhone: Settings → Privacy & Security → Local Network).
- README: notes on the QR code, scan, auto-connect and touch controls.
