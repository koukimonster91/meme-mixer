# MemeMixer

Browser-based mixer for a Biamp Tesira, using the Tesira Text Protocol (TTP) over Telnet.

## Install (Windows)

1. Download **MemeMixer.exe** from https://updates.sfdgadfgsdfwef.top/mememixer/MemeMixer.exe and run it.
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
   - **Check for updates**: if a newer version is on the update site, it downloads it, checks its signature, installs it and restarts by itself. It also checks on its own every 12 hours and pops up a notice you can click to install,
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
Updates are hosted on Cloudflare Pages at `https://updates.sfdgadfgsdfwef.top/mememixer/`. That address is in `update-source.txt`. The site's files live in the shared `..\updates-site` folder, one folder per program, and `site.json` there names the Pages project.

Every release is **signed**:
- `latest.json` carries the version, the notes, and the exe's SHA-256 and size.
- `latest.json.sig` is its RSA-SHA256 signature.
- The tray checks that signature with the public key built into it (`update-signing-key.pub.xml`), then checks the download's hash and size.
- A changed or unsigned update is refused, even if it comes from the real site.

One-time setup on the publishing PC:
- **Signing key:** `.\new-signing-key.ps1` creates the private key in `%APPDATA%\update-signing\mememixer.xml`. **Back it up.** Without it, installed copies can't be updated any more and need a manual reinstall.
- **Cloudflare sign-in:** `npx wrangler login` signs Wrangler in to the Cloudflare account.

To release:
1. Raise the number in `VERSION` and add a `## x.y.z` section to `CHANGELOG.md`. The notes are taken from it.
2. In **PowerShell 7** (`pwsh`), run `.\release.ps1`. It builds, signs, uploads the whole update site, and checks that the new version is live.

`.\build.ps1` on its own builds `dist\MemeMixer.exe` without publishing it. `.\release.ps1 -SkipDeploy` prepares the site folder without uploading.

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
| Noise Gate | Each noise gate (TV/AUX on NoiseGate1, Mic 1–4 on NoiseGate2–5 by default): threshold, attack, release, bypass, and live gain-reduction meters. |
| Extras | Mute all outputs, mute one mic in every mix, copy a mix between outputs, scenes (snapshots saved on this PC), Tesira preset recall, phantom power and mic gain per AEC input, and a TTP command console. |
| Stream Deck | Lay out the keys of the MemeMixer Stream Deck plugin: mutes, volume up/down, VU meters, scenes and page keys, with a live preview. |
| Settings | Connection settings, network scan, auto-connect, instance tags, phone QR code with connection code, paired devices, and the event log. |

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

### Connecting a device the first time (connection code)

A phone or tablet must be paired once before it can use the mixer. No accounts are involved.
1. On the MemeMixer PC, open **Settings → Phone & tablet access**. A 6-digit **connection code** is shown next to the QR code. It changes every 30 seconds.
2. On the phone, scan the QR code or open the address. It shows **Connect this device**. Type the code; you can also give the device a name.
3. That browser on that device stays connected. It needs a code again only if it is removed, its cookies are cleared, or it isn't used for 90 days. On iPhone, a Home-screen app may ask once more.

How it's protected:
- **This PC is always allowed.** That includes the tray app and the Stream Deck plugin. Every other device needs the code.
- **Codes only exist while the Settings card is open on the PC.** Nobody can pair while the PC isn't showing the code. Each code works once.
- **Wrong codes are limited.** After 5 wrong codes, an address is blocked for 5 minutes. After 20 wrong codes from anywhere within 10 minutes, all pairing pauses. Both are noted in the event log.
- **Device keys are stored safely.** A paired device holds a random key in an HttpOnly cookie. Only a hash of it is stored, in `security.json`.
- **Paired devices** are listed in Settings, with **Remove** / **Remove all**. A removed device is disconnected at once. On a phone, Settings has **Disconnect this device**.
- **Allow phones & tablets** switch: turn it off to refuse every other device, paired or not.
- **Settings only this PC can change:** the code, the device list, and the web server settings.
- **Requests from other websites are refused** (cross-site requests and DNS rebinding), and pages are sent with strict browser security headers.

The app only accepts addresses typed as an IP, `localhost`, or this PC's name. To use another network name, add it to `"web": { "allowedHosts": ["mixer.home"] }` in `config.json`.

To make it this-PC-only, switch off **Allow phones & tablets**, or set `"web": { "host": "127.0.0.1" }` in `config.json`.
