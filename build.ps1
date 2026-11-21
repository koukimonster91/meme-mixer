# Builds dist\MemeMixer.exe: the tray app with the web app embedded inside it.
# Needs only Windows (uses the C# compiler that ships with .NET Framework 4.x).
#   .\build.ps1                      # version from VERSION, repo from github-repo.txt
#   .\build.ps1 -Repo owner/name     # GitHub repository that updates come from
param([string]$Repo, [string]$Version, [string]$Out)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

$version = if ($Version) { $Version } else { (Get-Content (Join-Path $root 'VERSION') -Raw).Trim() }
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "VERSION must look like 1.2.3 (got '$version')" }
if (-not $Repo) {
  $repoFile = Join-Path $root 'github-repo.txt'
  $Repo = if (Test-Path $repoFile) { (Get-Content $repoFile -Raw).Trim() } else { 'OWNER/meme-mixer' }
}
if ($Repo -notmatch '^[\w.-]+/[\w.-]+$') { throw "Repo must look like owner/name (got '$Repo')" }

$build = Join-Path $root 'build'
$dist = Join-Path $root 'dist'
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Force $build, $dist | Out-Null

# 1. Web app files -> build\app.zip (no user settings, scenes or test tools)
$stage = Join-Path $build 'app'
New-Item -ItemType Directory -Force $stage | Out-Null
foreach ($f in 'server.js', 'tesira.js', 'discover.js', 'deck.js', 'mock-tesira.js') { Copy-Item (Join-Path $root $f) $stage }
Set-Content (Join-Path $stage 'VERSION') $version -NoNewline
Copy-Item (Join-Path $root 'public') (Join-Path $stage 'public') -Recurse
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Drawing

# 1b. Stream Deck plugin -> dist\MemeMixer.streamDeckPlugin (also served by the app for download)
function Save-LogoPng([int]$size, [string]$path, [bool]$dark) {
  $img = [System.Drawing.Image]::FromFile((Join-Path $root 'MM26_Logo_for_Tesira.png'))
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  if ($dark) { $g.Clear([System.Drawing.Color]::FromArgb(255, 13, 16, 23)) }
  $pad = if ($dark) { [int]($size * 0.16) } else { [int]($size * 0.04) }
  $h = $size - 2 * $pad; $w = [int]($h * $img.Width / $img.Height)
  $g.DrawImage($img, [int](($size - $w) / 2), $pad, $w, $h)
  $g.Dispose(); $img.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}
$pluginRoot = Join-Path $build 'plugin'
$sdp = Join-Path $pluginRoot 'com.mememixer.deck.sdPlugin'
New-Item -ItemType Directory -Force (Join-Path $sdp 'bin'), (Join-Path $sdp 'imgs') | Out-Null
Copy-Item (Join-Path $root 'streamdeck\plugin.js') (Join-Path $sdp 'bin\plugin.js')
Copy-Item (Join-Path $root 'public\deck-render.js') (Join-Path $sdp 'bin\deck-render.js')
'{ "type": "commonjs" }' | Set-Content (Join-Path $sdp 'bin\package.json') -Encoding ascii
(Get-Content (Join-Path $root 'streamdeck\manifest.json') -Raw).Replace('"Version": "0.0.0.0"', "`"Version`": `"$version.0`"") |
  Set-Content (Join-Path $sdp 'manifest.json') -Encoding UTF8
# The MemeMixer profile (all 15 keys are MemeMixer Keys) that Stream Deck installs with the plugin.
Copy-Item (Join-Path $root 'streamdeck\MemeMixer.streamDeckProfile') (Join-Path $sdp 'MemeMixer.streamDeckProfile')
foreach ($spec in @(@('plugin', 256, $false), @('category', 28, $false), @('action', 20, $false), @('key', 72, $true), @('open', 72, $true))) {
  Save-LogoPng $spec[1] (Join-Path $sdp "imgs\$($spec[0]).png") $spec[2]
  Save-LogoPng ($spec[1] * 2) (Join-Path $sdp "imgs\$($spec[0])@2x.png") $spec[2]
}
$pluginFile = Join-Path $dist 'MemeMixer.streamDeckPlugin'
if (Test-Path $pluginFile) { Remove-Item $pluginFile }
[System.IO.Compression.ZipFile]::CreateFromDirectory($sdp, $pluginFile, [System.IO.Compression.CompressionLevel]::Optimal, $true)
Copy-Item $pluginFile (Join-Path $stage 'public\MemeMixer.streamDeckPlugin')

[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, (Join-Path $build 'app.zip'))

# 2. Version + update source baked into the exe
@"
static class BuildInfo
{
    public const string Version = "$version";
    public const string Repo = "$Repo";
}
"@ | Set-Content (Join-Path $build 'BuildInfo.cs') -Encoding UTF8

# 3. Icon: the logo on a transparent background, in several sizes (PNG-compressed .ico)
$logo = [System.Drawing.Image]::FromFile((Join-Path $root 'MM26_Logo_for_Tesira.png'))
$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  # Just the logo on a transparent background, as large as it fits.
  $pad = if ($s -le 32) { 0 } else { [int]($s * 0.03) }
  $h = $s - 2 * $pad; $w = [int]($h * $logo.Width / $logo.Height)
  $g.DrawImage($logo, [int](($s - $w) / 2), $pad, $w, $h)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  , $ms.ToArray()
}
$logo.Dispose()
$ico = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ico
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $b = if ($s -ge 256) { 0 } else { $s }
  $bw.Write([byte]$b); $bw.Write([byte]$b); $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]$pngs[$i].Length); $bw.Write([uint32]$offset)
  $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $bw.Write($p) }
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $build 'MemeMixer.ico'), $ico.ToArray())

# 4. Compile
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
$out = if ($Out) { $Out } else { Join-Path $dist 'MemeMixer.exe' }
& $csc /nologo /target:winexe /optimize+ /platform:anycpu "/out:$out" `
  "/win32icon:$(Join-Path $build 'MemeMixer.ico')" `
  "/resource:$(Join-Path $build 'app.zip'),app.zip" `
  /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /r:System.Web.Extensions.dll `
  (Join-Path $root 'tray\MemeMixer.cs') (Join-Path $build 'BuildInfo.cs')
if ($LASTEXITCODE -ne 0) { throw 'compile failed' }

$size = [Math]::Round((Get-Item $out).Length / 1KB)
Write-Host "Built $out  (v$version, updates from github.com/$Repo, $size KB)"
