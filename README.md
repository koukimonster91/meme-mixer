# MemeMixer

Browser-based mixer for a Biamp Tesira, using the Tesira Text Protocol (TTP) over Telnet.

## Install (Windows)

1. Download **MemeMixer.exe** from the latest GitHub release and run it.
   Windows may show "Windows protected your PC" because the exe isn't code-signed. Click **More info → Run anyway**.
2. On the first run MemeMixer:
   - installs itself into `%LOCALAPPDATA%\MemeMixer` (no admin rights needed),
   - downloads Node.js (the current LTS, checked against nodejs.org's checksums),
   - adds Start Menu and Desktop shortcuts, an Apps & Features entry, and turns on **Run when Windows starts**,
   - asks for admin permission once, to let phones on your network through the firewall. You can decline; then only this PC can open it,
   - opens the mixer in your browser.
3. After that it runs in the taskbar tray (bottom-right, by the clock). Right-click the icon for:
   - **Open MemeMixer** (double-clicking the icon does the same),
   - **Demo mode (no Tesira needed)**: switches to a built-in fake Tesira so you can try everything without hardware. Demo settings and scenes are separate from your real ones. The same switch is in **Settings → Demo mode**,
   - **Run when Windows starts** (on/off),
   - **Install Stream Deck plugin** (see below),
   - **Check for updates**: if a newer release is on GitHub, it downloads it, installs it and restarts by itself. It also checks on its own every 12 hours and pops up a notice you can click to install,
   - **Open log folder**, and **Exit**.

Settings and scenes are kept in `%LOCALAPPDATA%\MemeMixer\data` and survive updates. To uninstall, go to **Settings → Apps → MemeMixer → Uninstall**.

### Stream Deck
MemeMixer comes with a Stream Deck plugin, made for the 15-key Stream Deck.
1. Install the Elgato Stream Deck app.
2. Right-click the MemeMixer tray icon → **Install Stream Deck plugin**. You can also download it from MemeMixer's **Stream Deck** page and double-click the file.
3. The plugin adds a ready-made **MemeMixer** profile with all 15 keys set up. On your usual profile, drag **MemeMixer → Open MemeMixer** onto a key to jump into it. An X key (set up in MemeMixer) jumps back. If you made your own MemeMixer profile before 1.4.0, delete it in the Stream Deck app to avoid having two.

Every key is then set up in MemeMixer on the **Stream Deck** page:
- **Mute on/off:** sources in a mix, mix masters, all sources in a mix, Input Master channels, a source in every mix, or all outputs.
- **Volume up/down:** any fader. Hold the key to repeat.
- **VU meter**, **recall a scene**, **change page**, **show the page name**, and an **X key** that returns to your previous Stream Deck profile.

**Export layout** and **Import layout…** on the same page move a layout to another PC.

Changes show up on the Stream Deck within a moment. The plugin finds MemeMixer on this PC by itself. If MemeMixer isn't running, the keys say so.

### Publishing an update
1. Raise the number in `VERSION` (e.g. `1.0.0` → `1.0.1`) and note the changes in `CHANGELOG.md`.
2. Run `.\release.ps1 -Notes "What changed"`. This needs the GitHub CLI signed in (`gh auth login`), and `github-repo.txt` must contain the repository as `owner/name`.

`.\build.ps1` on its own builds `dist\MemeMixer.exe` without publishing it.

## Run from source

- **start.bat**: starts the app and opens http://localhost:8080. Needs Node.js.
- **start-demo.bat**: starts a fake Tesira on port 2323 plus the app on http://localhost:8081, so you can try the UI with no hardware.

On first run, open **Settings**:
1. Click **Scan network** and then **Connect** next to your Tesira. Or enter its IP and Telnet port (23 by default) and click **Save & connect**.
   With **Auto-connect** on (the default), if the Tesira stops answering at the saved address, the app scans the network and switches to the Tesira it finds there. It only switches when it finds exactly one. The scan looks for the Tesira Text Protocol on the Telnet port of every address on this PC's local subnet (up to a /24), so Telnet must be enabled on the Tesira.
2. Check the instance tags. Once connected, each box offers the tags reported by the Tesira. A tag that isn't on the device is outlined in amber.

## Pages

| Page | Controls |
|---|---|
| Headphone 1–4, USB Out | Crosspoint level and mute for each source in the matrix mixer (Mic 1–4, TV/AUX, PC; USB Out has no PC), plus the output's Master level and mute. Source meters come from the Peak Meter after the Input Master. Each Master has its own L/R meter from that output's master peak meter (set in Settings). |
| Matrix | Every crosspoint of the matrix mixer in one grid. Drag a cell up or down (or use the wheel) to set its level, click its dot to switch it on or off, or double-click it to type a level. |
| Input Master | Level and mute for each Input Master channel. TV/AUX and PC L/R are linked by default; use the link button to unlink them. |
| Noise Gate | Each noise gate (the main gate plus one per mic, NoiseGate1–5 by default): threshold, attack, release, bypass, and live gain-reduction meters. |
| Extras | Mute all outputs, mute one mic in every mix, copy a mix between outputs, scenes (snapshots saved on this PC), Tesira preset recall, phantom power and mic gain per AEC input, and a TTP command console. |
| Stream Deck | Lay out the keys of the MemeMixer Stream Deck plugin: mutes, volume up/down, VU meters, scenes and page keys, with a live preview. |
| Settings | Connection settings, network scan, auto-connect, instance tags, phone QR code and the event log. |

Every fader works the same way:
- Drag it. Hold **Shift** for fine moves.
- Use the mouse wheel or the arrow keys.
- Double-click it to go to 0 dB.
- Pull it to the bottom to mute the channel. Moving it back up unmutes it.
- On a phone or tablet, drag up or down to move it. A tap or a sideways swipe scrolls the page and doesn't change the level.
- Type a value in the box above it and press **Enter**. `off` or `-inf` sets the minimum.

## Channel routing

Routing lives in `config.json`, which is created on first run:
- `sources[].inputs`: matrix mixer input numbers. A mono source feeds both L and R; a stereo source feeds L→L and R→R.
- `outputs[].mixerOutputs`: the L and R matrix outputs for each output. `master` picks the entry in `tags.masters`.
- `inputChannels`: Input Master channels, plus their meter channel and stereo link partner.

The default mapping assumes this order:
- Mixer inputs: Mic 1–4 = 1–4, TV/AUX = 5/6, PC = 7/8.
- Mixer outputs: Headphone 1 = 1/2, Headphone 2 = 3/4, Headphone 3 = 5/6, Headphone 4 = 7/8, USB = 9/10.

## Phone and tablet access

The app listens on your network, so phones and tablets on the same network can use it. When `start.bat` starts, the window prints the address to use (for example `http://192.168.1.50:8080`). The same address is shown under **Settings → Phone & tablet access**, with a QR code you can scan with the phone's camera. Or type the address into the phone's browser. To open it like an app, use **Add to Home screen**.

Windows has to let the connection through, which you only need to set up once:
- Either click **Allow** on **Private networks** when Windows Firewall asks the first time the app starts,
- or run this in an **administrator** PowerShell:
  `New-NetFirewallRule -DisplayName "MemeMixer" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private`

If one browser on the phone says "This site can't be reached" but another browser works, the phone is blocking that browser from the local network. Allow it in the phone's settings:
- **Android:** Settings → Apps → Chrome (or the browser you use) → Permissions → **Nearby devices** / **Local network**. Then close the browser fully and reopen it.
- **iPhone:** Settings → Privacy & Security → **Local Network**, then turn the browser on.

To make it this-PC-only again, set `"web": { "host": "127.0.0.1" }` in `config.json`. Anyone on the network who opens the address can control the mixer.
