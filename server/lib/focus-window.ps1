# Bring a window to the foreground (Windows). Used by lib/focus.js.
#
# Input (environment variables, so nothing user-controlled is ever pasted into this script):
#   FOCUS_PROCS    JSON array of process-name fragments, e.g. ["jellyfin","code"]
#   FOCUS_TITLES   JSON array of window-title fragments (browsers are ignored for title matches)
#   FOCUS_TIMEOUT  seconds to keep waiting for a matching window to appear
# Exit code 0 = a matching window is now in the foreground, 1 = none found / Windows refused.
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Fg {
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

  public static bool Focus(IntPtr h) {
    ShowWindow(h, IsIconic(h) ? 9 : 5);              // SW_RESTORE if minimised, else SW_SHOW
    // Windows only lets the foreground process change the foreground window. A synthetic Alt key press
    // plus attaching to the foreground thread's input queue is the standard way around that.
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    uint pid;
    uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    uint me = GetCurrentThreadId();
    bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    if (attached) AttachThreadInput(me, fgThread, false);
    return GetForegroundWindow() == h;
  }
}
"@

$procs  = @(); if ($env:FOCUS_PROCS)  { $procs  = @(ConvertFrom-Json $env:FOCUS_PROCS)  | ForEach-Object { "$_".ToLower() } | Where-Object { $_ } }
$titles = @(); if ($env:FOCUS_TITLES) { $titles = @(ConvertFrom-Json $env:FOCUS_TITLES) | ForEach-Object { "$_".ToLower() } | Where-Object { $_ } }
$timeout = 10; if ($env:FOCUS_TIMEOUT) { $timeout = [double]$env:FOCUS_TIMEOUT }
if (-not $procs.Count -and -not $titles.Count) { exit 1 }

$browsers = 'chrome','msedge','firefox','brave','opera','vivaldi','iexplore','arc'
$self = $PID
$deadline = (Get-Date).AddSeconds($timeout)

function Find-Window {
  $found = @()
  foreach ($p in Get-Process) {
    if ($p.Id -eq $self -or $p.MainWindowHandle -eq [IntPtr]::Zero) { continue }
    $name = $p.ProcessName.ToLower()
    $title = ("" + $p.MainWindowTitle).ToLower()
    $hit = $false
    foreach ($m in $procs) { if ($name.Contains($m)) { $hit = $true; break } }
    if (-not $hit -and $browsers -notcontains $name) {
      foreach ($m in $titles) { if ($title.Contains($m)) { $hit = $true; break } }
    }
    if ($hit) { $found += $p }
  }
  # newest process first: if the app was just started, that is the window the user wants
  $found | Sort-Object { try { $_.StartTime } catch { [datetime]::MinValue } } -Descending
}

do {
  foreach ($p in (Find-Window)) {
    if ([Fg]::Focus($p.MainWindowHandle)) { exit 0 }
  }
  Start-Sleep -Milliseconds 300
} while ((Get-Date) -lt $deadline)
exit 1
