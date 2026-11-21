# One-time setup: creates the key that signs MemeMixer updates.
#   Private key: %APPDATA%\update-signing\mememixer.xml  (stays on this PC, never commit or share it)
#   Public key:  update-signing-key.pub.xml in this folder (built into MemeMixer.exe; fine to share)
# Installed copies only accept updates signed with this key. If the private key is lost, installed
# copies can't be updated any more and need MemeMixer.exe installed again by hand, so back it up.
#Requires -Version 7
$ErrorActionPreference = 'Stop'
$keyDir = Join-Path $env:APPDATA 'update-signing'
$private = Join-Path $keyDir 'mememixer.xml'
$public = Join-Path $PSScriptRoot 'update-signing-key.pub.xml'
if (Test-Path $private) { throw "A signing key already exists at $private. Delete it first only if you really mean to replace it (installed copies would stop accepting updates)." }
New-Item -ItemType Directory -Force $keyDir | Out-Null
$rsa = [System.Security.Cryptography.RSA]::Create(3072)
Set-Content $private $rsa.ToXmlString($true) -NoNewline -Encoding ascii
Set-Content $public $rsa.ToXmlString($false) -NoNewline -Encoding ascii
# Only this Windows user can read the private key.
icacls $private /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
Write-Host "Private key: $private  (back this file up somewhere safe)"
Write-Host "Public key:  $public"
