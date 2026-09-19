<#
.SYNOPSIS
  Open Fractal Alps in Chrome on the DISCRETE GPU, without changing a thing on
  this machine.

.DESCRIPTION
  A web page cannot choose its own GPU. The browser picks an adapter when its
  GPU process starts -- long before the page exists -- from a per-app OS
  preference or a command-line flag, and `powerPreference: 'high-performance'`
  in the WebGL context is only a hint that Windows hybrid laptops routinely
  ignore. Measured on the dev machine: the same build ran 1707x932 on an
  RTX 4090 and was pinned to the renderer's 683x359 floor on the Intel iGPU in
  the same laptop.

  The permanent fix is a registry entry under
  HKCU:\Software\Microsoft\DirectX\UserGpuPreferences, but that edits someone
  else's machine and persists. This script does it the disposable way instead:

    --force-high-performance-gpu   asks Windows for the discrete adapter
    --user-data-dir=<temp>         forces a genuinely NEW Chrome process

  The second flag is not optional. Chrome is single-instance per user-data-dir,
  so if any Chrome is already running, a plain `chrome.exe <url>` hands the URL
  to the existing process and every flag is silently discarded. A throwaway
  profile is the only way to get a process that honours them.

  Nothing persists: no registry write, no change to the real Chrome profile.
  The temp profile is deleted when the window closes.

.PARAMETER Target
  File or URL to open. Defaults to the single-file build next to this script.

.PARAMETER Keep
  Leave the temporary profile behind (for debugging this script).

.EXAMPLE
  .\launch-rtx.ps1
  .\launch-rtx.ps1 -Target http://127.0.0.1:8734/index.html

.NOTES
  Written for Windows PowerShell 5.1, which is what the dev machine has: no
  '&&', no '||', no ternary, no null-coalescing. See CLAUDE.md.
  If PowerShell refuses to run it:
      powershell -ExecutionPolicy Bypass -File .\launch-rtx.ps1
#>
[CmdletBinding()]
param(
    [string] $Target,
    [switch] $Keep
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# ---- what to open -----------------------------------------------------------
# Default to the newest fractal-flight-v*.html beside this script, so the
# version bump does not have to be mirrored here every release.
if (-not $Target) {
    $build = Get-ChildItem -Path $here -Filter 'fractal-flight-v*.html' -ErrorAction SilentlyContinue |
             Sort-Object Name -Descending | Select-Object -First 1
    if (-not $build) {
        Write-Host "No fractal-flight-v*.html found next to this script." -ForegroundColor Red
        Write-Host "Pass one explicitly:  .\launch-rtx.ps1 -Target <file-or-url>"
        exit 1
    }
    $Target = $build.FullName
}
# A local path has to be a file:// URL for Chrome to accept it as an argument.
if (Test-Path -LiteralPath $Target) { $Target = ([System.Uri](Resolve-Path -LiteralPath $Target).Path).AbsoluteUri }

# ---- find Chrome ------------------------------------------------------------
# Three standard locations: 64-bit, 32-bit, and the per-user install that
# needs no admin rights and is easy to forget.
$candidates = @(
    (Join-Path $env:ProgramFiles        'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA        'Google\Chrome\Application\chrome.exe')
)
$chrome = $null
foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c)) { $chrome = $c; break }
}
if (-not $chrome) {
    Write-Host "Chrome not found in any of:" -ForegroundColor Red
    $candidates | ForEach-Object { Write-Host "  $_" }
    Write-Host "Edge takes the same flags if you would rather use it."
    exit 1
}

# ---- a throwaway profile ----------------------------------------------------
$profileDir = Join-Path $env:TEMP ("ff-rtx-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $profileDir -Force | Out-Null

Write-Host ""
Write-Host "Fractal Alps -- discrete GPU launch" -ForegroundColor Cyan
Write-Host "  chrome   : $chrome"
Write-Host "  target   : $Target"
Write-Host "  profile  : $profileDir  (temporary)"
Write-Host ""
Write-Host "Check it worked: the start page warns if it landed on the integrated GPU," -ForegroundColor DarkGray
Write-Host "or open chrome://gpu and read GL_RENDERER." -ForegroundColor DarkGray
Write-Host ""

$chromeArgs = @(
    "--user-data-dir=$profileDir",
    '--force-high-performance-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    $Target
)

try {
    $proc = Start-Process -FilePath $chrome -ArgumentList $chromeArgs -PassThru
    Write-Host "Running (PID $($proc.Id)). Close the window to clean up." -ForegroundColor Green
    Wait-Process -Id $proc.Id
    # Chrome's launcher can hand off to a child and exit first. Give any process
    # still holding THIS profile a moment to go, or the delete below fails.
    for ($i = 0; $i -lt 20; $i++) {
        $held = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
                Where-Object { $_.CommandLine -like "*$profileDir*" }
        if (-not $held) { break }
        Start-Sleep -Milliseconds 500
    }
}
finally {
    if ($Keep) {
        Write-Host "Profile kept at $profileDir" -ForegroundColor Yellow
    }
    else {
        try {
            Remove-Item -LiteralPath $profileDir -Recurse -Force -ErrorAction Stop
            Write-Host "Temporary profile removed. Nothing was changed on this machine." -ForegroundColor Green
        }
        catch {
            # Not worth failing over: it is under TEMP and Windows will reap it.
            Write-Host "Could not remove $profileDir (Chrome may still hold a lock)." -ForegroundColor Yellow
            Write-Host "It is under TEMP and is safe to delete by hand."
        }
    }
}
