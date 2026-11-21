# Changelog

## 1.6.0 (2026-11-21)

### Added
- **Connection code for phones and tablets.** A device connecting for the first time shows **Connect this device** and asks for a 6-digit code.
  - The code is shown on the PC next to the QR code, in **Settings → Phone & tablet access**.
  - It changes every 30 seconds and works once.
  - After that, the device stays connected. No accounts.
- **Paired devices list** on the PC, with **Remove** and **Remove all**. A removed device is disconnected immediately. A phone can also **Disconnect this device** itself.
- **Allow phones & tablets** switch, to refuse every other device, paired or not.

### Security
- Only devices paired with a code can reach the mixer, its live updates or its controls. This PC is always allowed, including the tray app and the Stream Deck plugin.
- Codes only exist while the Phone & tablet card is open on the PC.
- Wrong codes are rate limited: 5 per address, then a 5-minute block; 20 in total, then pairing pauses.
- Device keys are stored only as hashes.
- Requests from other websites and DNS-rebinding tricks are refused. Pages carry strict browser security headers (content policy, no framing, no sniffing).
- Only this PC can change the pairing, the device list, and the web server settings.

## 1.5.3 (2026-11-21)

### Changed
- The first noise gate (NoiseGate1) is now called **TV/AUX** instead of "Gate", and its meters are labelled **TV/AUX L / R**. Existing settings are renamed automatically; a gate name you changed yourself is kept.

## 1.5.2 (2026-11-21)

### Fixed
- **USB Out master meter is on AudioMeter3 too,** on channels 9–10. It switches over automatically from the 1.5.1 default (AudioMeter7) and from older defaults. Meter tags you changed yourself are left alone.

## 1.5.1 (2026-11-21)

### Fixed
- **Headphone master meters share one meter block.** The headphone master meters are all on **AudioMeter3**: Headphone 1 on channels 1–2, Headphone 2 on 3–4, Headphone 3 on 5–6, Headphone 4 on 7–8. Before, MemeMixer expected a separate meter block per output.
- Settings has a **Channels (L, R)** box next to each output's master meter tag, so any output can use any pair of channels on any meter block.
- If your meter tags were still the old defaults (AudioMeter3–7), they switch to the shared AudioMeter3 layout automatically. The USB Out meter is unchanged.

## 1.5.0 (2026-11-21)

### Added
- **Noise gates for each mic.** The Noise Gate page now handles several gates. Chips at the top pick **Gate** (the existing NoiseGate1) or **Mic 1–4** (NoiseGate2–NoiseGate5). Each gate has its own threshold, attack, release, bypass and gain-reduction meter, and a chip shows **Bypassed** when its gate is bypassed.
- **Settings:** one instance-tag field per gate, checked against the Tesira's own list like the other tags.
- **Stream Deck:** gate threshold up/down and gate reduction meter keys have a **Gate** picker. Keys made before 1.5.0 keep controlling the first gate.
- Existing settings move over automatically: the current gate keeps its tag and channel names, and the four mic gates are added.

## 1.4.1 (2026-11-21)

### Added
- **Tesira design file download:** Settings has a new **Tesira design file** card. It downloads the Tesira Designer file MemeMixer is set up for (`MM26_Tesira_1b.tmf`), which is kept in the GitHub project's `tesira/` folder, and links to all versions there.

## 1.4.0 (2026-11-21)

### Fixed
- **The X (Exit) key didn't change profile.** Stream Deck only lets a plugin switch away from a profile that comes with the plugin. The plugin now includes a ready-made **MemeMixer** profile, with all 15 keys set up, that Stream Deck adds when the plugin is installed.

### Added
- **Open MemeMixer** Stream Deck action: put it on your usual profile to jump into the MemeMixer profile. The X key jumps back.
- No more dragging the action onto 15 keys: the bundled profile already has them.

## 1.3.0 (2026-11-21)

### Added
- **Exit key (X):** a Stream Deck key with a big X that switches the Stream Deck back to the profile you were using before. Stream Deck lets plugins return to the previous profile, but not open your own profiles by name.
- **Page name key:** shows the name of the page it's on (for example "Headphone 1 · Page 1 of 5"). Pressing it does nothing.
- **Export / import the Stream Deck layout:** on the Stream Deck page, **Export layout** saves all pages and keys to a `.json` file, and **Import layout…** loads one, for example on another PC. Files that aren't MemeMixer layouts are refused.

## 1.2.2 (2026-11-20)

### Fixed
- **Stream Deck page buttons flickered and ignored clicks:** the key preview rebuilt all 15 keys about 10 times a second, because of the live meters. The keys now stay in place and only their pictures update, so hover is steady and one click works.

## 1.2.1 (2026-11-20)

### Changed
- **One Stream Deck layout for normal and demo mode.** Switching to demo now shows your own keys, driven by the fake Tesira. The layout is saved in its own file (`streamdeck.json`). A layout made in 1.2.0 is moved there automatically. The Tesira address, tags and scenes are still separate between the two modes.

## 1.2.0 (2026-11-20)

### Added
- **Stream Deck plugin.** You lay out the keys in MemeMixer on the new **Stream Deck** page: 15 keys (5 × 3) per page, with as many pages as you like. Each key can be one of:
  - **Mute on/off:** a source in a mix, a mix master, all sources in a mix, an Input Master channel, a source in every mix, or all outputs. The key turns red when muted and stays in sync with the web page and phones.
  - **Volume up / down:** every fader (sources in a mix, mix masters, Input Master channels, noise gate threshold), with your choice of step. Hold the key to repeat. Pulling a level to the bottom mutes it, the same as the faders.
  - **VU meter:** a live meter on the key for a source, a mix master, an Input Master channel, or noise gate reduction.
  - **Recall a scene** and **Change page** (next, previous, or a specific page).
- The Stream Deck page shows a live preview of the keys. Click a key to set it up, or drag keys to move them. A default layout gives one page per output.
- **Installing the plugin:** right-click the tray icon → **Install Stream Deck plugin**, or download it from the Stream Deck page. After a MemeMixer update, the tray offers to update an installed plugin.

## 1.1.1 (2026-11-20)

### Changed
- **Renamed to MemeMixer** (one word) everywhere: the tray icon, menus, Start Menu and Desktop shortcuts, the startup entry, Apps & Features, and the web page. Updating renames the old "Meme Mixer" shortcuts and the startup entry automatically.
- **Tray icon:** just the logo now, without the dark square behind it.

## 1.1.0 (2026-11-20)

### Added
- **Demo mode:** try Meme Mixer without a Tesira. Switch it on from the tray menu (**Demo mode (no Tesira needed)**) or in **Settings → Demo mode**, which also works from a phone. Meme Mixer then uses a built-in fake Tesira with moving meters. Demo settings and scenes are kept separate, so your real setup is untouched when you switch back. While it's on, the sidebar and connection badge show "Demo mode" in amber.

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
