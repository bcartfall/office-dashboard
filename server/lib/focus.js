/**
 * Bring an application's window to the foreground, waiting for it to appear if it was only just started.
 *
 *   focusApp({ processes: ['jellyfin'], titles: ['Jellyfin'], timeoutSeconds: 15 })
 *
 * Windows is the primary target (a small PowerShell helper, see focus-window.ps1). macOS and Linux are
 * best effort (osascript / wmctrl / xdotool, whichever exists). Never throws: resolves to true when a window
 * was brought forward, false otherwise, so callers can treat it as a nicety.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'focus-window.ps1');

const clean = (list) => [...new Set((list || []).map((s) => String(s ?? '').trim()).filter((s) => s.length >= 2 && !/[\0\r\n]/.test(s)))];

/** "C:\Program Files\Jellyfin Desktop\jellyfin-desktop.exe" -> "jellyfin-desktop"; URLs and shell verbs -> null */
export function processNameFromCommand(command) {
  const c = String(command || '').trim();
  if (!c || /^[a-z][a-z0-9+.-]*:\/\//i.test(c)) return null;
  const base = c.split(/[\\/]/).pop().replace(/\.(exe|com|bat|cmd|lnk|app|appimage)$/i, '');
  return base || null;
}

export async function focusApp({ processes = [], titles = [], timeoutSeconds = 10 } = {}) {
  const procs = clean(processes);
  const tits = clean(titles);
  if (!procs.length && !tits.length) return false;
  const timeout = Math.min(60, Math.max(1, Number(timeoutSeconds) || 10));
  try {
    if (process.platform === 'win32') return await focusWindows(procs, tits, timeout);
    if (process.platform === 'darwin') return await focusMac(procs, tits, timeout);
    return await focusLinux(procs, tits, timeout);
  } catch (err) {
    console.warn(`[focus] ${err.message}`);
    return false;
  }
}

/** Like focusApp but doesn't make the caller wait. */
export function focusAppInBackground(opts) {
  focusApp(opts).then((ok) => {
    if (!ok) console.warn(`[focus] no window to bring forward for ${JSON.stringify(opts.processes || opts.titles)}`);
  });
}

function run(file, args, { env, timeout } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { env: { ...process.env, ...env }, timeout, windowsHide: true }, (err, stdout) => resolve({ ok: !err, stdout: String(stdout || '') }));
  });
}

async function focusWindows(procs, titles, timeout) {
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], {
    env: { FOCUS_PROCS: JSON.stringify(procs), FOCUS_TITLES: JSON.stringify(titles), FOCUS_TIMEOUT: String(timeout) },
    timeout: (timeout + 15) * 1000,
  });
  return r.ok;
}

async function focusMac(procs, titles, timeout) {
  const deadline = Date.now() + timeout * 1000;
  const names = [...procs, ...titles];
  do {
    for (const name of names) {
      // `name` is passed as an argument (never spliced into the script)
      const r = await run('osascript', ['-e', 'on run argv', '-e', 'tell application (item 1 of argv) to activate', '-e', 'end run', name], { timeout: 5000 });
      if (r.ok) return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  } while (Date.now() < deadline);
  return false;
}

async function focusLinux(procs, titles, timeout) {
  const deadline = Date.now() + timeout * 1000;
  do {
    for (const name of [...titles, ...procs]) {
      if ((await run('wmctrl', ['-a', name], { timeout: 3000 })).ok) return true;
      const found = await run('xdotool', ['search', '--onlyvisible', '--name', name], { timeout: 3000 });
      const id = found.ok ? found.stdout.split('\n').find(Boolean) : null;
      if (id && (await run('xdotool', ['windowactivate', id], { timeout: 3000 })).ok) return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  } while (Date.now() < deadline);
  return false;
}
