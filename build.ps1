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
foreach ($f in 'server.js', 'tesira.js', 'discover.js', 'mock-tesira.js') { Copy-Item (Join-Path $root $f) $stage }
Set-Content (Join-Path $stage 'VERSION') $version -NoNewline
Copy-Item (Join-Path $root 'public') (Join-Path $stage 'public') -Recurse
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, (Join-Path $build 'app.zip'))

# 2. Version + update source baked into the exe
@"
static class BuildInfo
{
    public const string Version = "$version";
    public const string Repo = "$Repo";
}
"@ | Set-Content (Join-Path $build 'BuildInfo.cs') -Encoding UTF8

# 3. Icon: the logo on a dark rounded tile, in several sizes (PNG-compressed .ico)
Add-Type -AssemblyName System.Drawing
$logo = [System.Drawing.Image]::FromFile((Join-Path $root 'MM26_Logo_for_Tesira.png'))
$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  $r = [Math]::Max(2, [int]($s * 0.22))
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90); $path.AddArc($s - 2 * $r - 1, 0, 2 * $r, 2 * $r, 270, 90)
  $path.AddArc($s - 2 * $r - 1, $s - 2 * $r - 1, 2 * $r, 2 * $r, 0, 90); $path.AddArc(0, $s - 2 * $r - 1, 2 * $r, 2 * $r, 90, 90); $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 21, 25, 34))), $path)
  $pad = if ($s -le 24) { [int]($s * 0.06) } else { [int]($s * 0.1) }
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
