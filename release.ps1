# Publishes a new version to the update site (Cloudflare Pages) so installed copies can update themselves.
#   1. Raise the number in VERSION (e.g. 1.7.0 -> 1.7.1) and add a "## 1.7.1" section to CHANGELOG.md
#   2. .\release.ps1                  (notes come from CHANGELOG.md; or pass -Notes "What changed")
#
# Needs (one-time setup, see README "Publishing updates"):
#   - PowerShell 7 (pwsh)
#   - the signing key from new-signing-key.ps1 (%APPDATA%\update-signing\mememixer.xml)
#   - the shared update-site folder (..\updates-site, with site.json naming the Cloudflare Pages project)
#   - Wrangler signed in to Cloudflare once: npx wrangler login
#Requires -Version 7
param([string]$Notes, [string]$Site, [switch]$SkipDeploy)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

$version = (Get-Content (Join-Path $root 'VERSION') -Raw).Trim()
$base = (Get-Content (Join-Path $root 'update-source.txt') -Raw).Trim().TrimEnd('/')
$folder = ([Uri]$base).AbsolutePath.Trim('/')
if (-not $folder) { throw 'update-source.txt should end in a folder name, e.g. https://updates.example.com/mememixer' }
if (-not $Site) { $Site = if ($env:UPDATES_SITE) { $env:UPDATES_SITE } else { Join-Path (Split-Path $root) 'updates-site' } }
$siteCfg = Get-Content (Join-Path $Site 'site.json') -Raw | ConvertFrom-Json
$keyFile = Join-Path $env:APPDATA 'update-signing\mememixer.xml'
if (-not (Test-Path $keyFile)) { throw "No signing key at $keyFile. Run .\new-signing-key.ps1 once (or restore your backup)." }
$dir = Join-Path $Site $folder
New-Item -ItemType Directory -Force $dir | Out-Null

# Never go backwards: the published version must be older than this one.
$latestPath = Join-Path $dir 'latest.json'
if (Test-Path $latestPath) {
  $prev = (Get-Content $latestPath -Raw | ConvertFrom-Json).version
  if ([version]$version -le [version]$prev) { throw "$prev is already published. Raise the number in VERSION first." }
}

# Release notes: the CHANGELOG.md section for this version, unless given.
if (-not $Notes) {
  $log = Get-Content (Join-Path $root 'CHANGELOG.md') -Raw
  $m = [regex]::Match($log, "(?ms)^## $([regex]::Escape($version))\b[^\n]*\n(.*?)(?=^## |\z)")
  $Notes = if ($m.Success) { ($m.Groups[1].Value -replace '\*\*', '' -replace '`', '' -replace '(?m)^### (.*?)\s*$', '$1:').Trim() } else { "MemeMixer $version" }
}

& (Join-Path $root 'build.ps1')
$exe = Join-Path $root 'dist\MemeMixer.exe'

# Files on the update site
$exeName = "MemeMixer-$version.exe"
Copy-Item $exe (Join-Path $dir $exeName) -Force
Copy-Item $exe (Join-Path $dir 'MemeMixer.exe') -Force             # stable download link for new installs
Copy-Item (Join-Path $root 'dist\MemeMixer.streamDeckPlugin') $dir -Force
Get-ChildItem (Join-Path $root 'tesira') -Filter *.tmf | Copy-Item -Destination $dir -Force   # Tesira design file (Settings link)
# keep the 3 newest versioned exes
Get-ChildItem $dir -Filter 'MemeMixer-*.exe' | Sort-Object { [version]($_.BaseName -replace '^MemeMixer-', '') } -Descending | Select-Object -Skip 3 | Remove-Item

# latest.json, signed with the private key; checked against the public key built into the exe
$manifest = [ordered]@{
  app       = 'MemeMixer'
  version   = $version
  published = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  notes     = $Notes
  exe       = [ordered]@{ file = $exeName; sha256 = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant(); size = (Get-Item $exe).Length }
}
$bytes = [System.Text.UTF8Encoding]::new($false).GetBytes(($manifest | ConvertTo-Json -Depth 5))
$rsa = [System.Security.Cryptography.RSA]::Create()
$rsa.FromXmlString((Get-Content $keyFile -Raw))
$sig = $rsa.SignData($bytes, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
$pub = [System.Security.Cryptography.RSA]::Create()
$pub.FromXmlString((Get-Content (Join-Path $root 'update-signing-key.pub.xml') -Raw))
if (-not $pub.VerifyData($bytes, $sig, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)) {
  throw 'The signing key does not match update-signing-key.pub.xml. Installed copies would refuse this update.'
}
[System.IO.File]::WriteAllBytes($latestPath, $bytes)
Set-Content (Join-Path $dir 'latest.json.sig') ([Convert]::ToBase64String($sig)) -NoNewline -Encoding ascii
Write-Host "Prepared $version in $dir"
if ($SkipDeploy) { return }

# Upload the whole site (all projects' folders) to Cloudflare Pages
npx --yes wrangler@4 pages deploy $Site --project-name $siteCfg.project --branch main --commit-dirty=true
if ($LASTEXITCODE -ne 0) { throw 'Upload to Cloudflare failed. If it asks you to sign in: npx wrangler login' }

# Check it's live
$want = [System.Text.Encoding]::UTF8.GetString($bytes)
for ($i = 0; $i -lt 10; $i++) {
  try { $got = (Invoke-WebRequest "$base/latest.json?t=$([DateTime]::UtcNow.Ticks)" -UseBasicParsing).Content } catch { $got = $null }
  if ($got -is [byte[]]) { $got = [System.Text.Encoding]::UTF8.GetString($got) }
  if ($got -eq $want) { break }
  Start-Sleep 3
}
if ($got -ne $want) { Write-Warning "Uploaded, but $base/latest.json doesn't show $version yet. Check the custom domain in Cloudflare." }
else { Write-Host "Released $version. Installed copies will offer it within 12 hours, or right away from 'Check for updates'." }
Write-Host "Download link for new installs: $base/MemeMixer.exe"
