param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('add', 'remove')]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$CliDir
)

$ErrorActionPreference = 'Stop'

function Normalize-PathEntry {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ''
  }

  return $Value.Trim().Trim('"').TrimEnd('\').ToLowerInvariant()
}

$current = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @()
if (-not [string]::IsNullOrWhiteSpace($current)) {
  $entries = $current -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
}

$target = Normalize-PathEntry $CliDir
$seen = [System.Collections.Generic.HashSet[string]]::new()
$nextEntries = New-Object System.Collections.Generic.List[string]

foreach ($entry in $entries) {
  $normalized = Normalize-PathEntry $entry
  if ([string]::IsNullOrWhiteSpace($normalized)) {
    continue
  }

  if ($normalized -eq $target) {
    continue
  }

  if ($seen.Add($normalized)) {
    $nextEntries.Add($entry.Trim().Trim('"'))
  }
}

$status = 'already-present'
if ($Action -eq 'add') {
  if ($seen.Add($target)) {
    $nextEntries.Add($CliDir)
    $status = 'updated'
  }
} elseif ($entries.Count -ne $nextEntries.Count) {
  $status = 'updated'
}

$newPath = if ($nextEntries.Count -eq 0) { $null } else { $nextEntries -join ';' }
[Environment]::SetEnvironmentVariable('Path', $newPath, 'User')

Add-Type -Namespace OpenClaw -Name NativeMethods -MemberDefinition @"
using System;
using System.Runtime.InteropServices;
public static class NativeMethods {
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
  public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd,
    int Msg,
    IntPtr wParam,
    string lParam,
    int fuFlags,
    int uTimeout,
    out IntPtr lpdwResult
  );
}
"@

$result = [IntPtr]::Zero
[OpenClaw.NativeMethods]::SendMessageTimeout(
  [IntPtr]0xffff,
  0x001A,
  [IntPtr]::Zero,
  'Environment',
  0x0002,
  5000,
  [ref]$result
) | Out-Null

Write-Output $status
