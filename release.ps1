# Publishes a new version to GitHub so installed copies can update themselves.
#   1. Bump the number in VERSION (e.g. 1.0.0 -> 1.0.1) and add notes to CHANGELOG.md
#   2. .\release.ps1 -Notes "What changed"
# Needs the GitHub CLI signed in (gh auth login) and github-repo.txt containing owner/name.
param([string]$Notes)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

$repo = (Get-Content (Join-Path $root 'github-repo.txt') -Raw).Trim()
$version = (Get-Content (Join-Path $root 'VERSION') -Raw).Trim()
$tag = "v$version"

gh auth status *> $null
if ($LASTEXITCODE -ne 0) { throw 'Sign in to GitHub first: gh auth login' }
gh release view $tag --repo $repo *> $null
if ($LASTEXITCODE -eq 0) { throw "$tag is already released. Raise the number in VERSION first." }

& (Join-Path $root 'build.ps1') -Repo $repo
if (-not $Notes) { $Notes = "MemeMixer $version" }

gh release create $tag (Join-Path $root 'dist\MemeMixer.exe') --repo $repo --title "MemeMixer $version" --notes $Notes
if ($LASTEXITCODE -ne 0) { throw 'gh release create failed' }
Write-Host "Released $tag. Installed copies will offer it within 12 hours, or right away from 'Check for updates'."
Write-Host "Download link for new users: https://github.com/$repo/releases/latest/download/MemeMixer.exe"
