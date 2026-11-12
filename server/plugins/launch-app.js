import { spawn } from 'node:child_process';

/**
 * Launch a program (or open a URL / file) detached from the server.
 * The command and arguments come from the plugin instance's own settings.
 */
export default {
  id: 'launch-app',
  name: 'Launch App',
  description: 'Start a program with optional launch arguments',
  routes(router) {
    router.post('/run', async (req, res) => {
      const command = String(req.body?.command ?? '').trim();
      const args = splitArgs(String(req.body?.args ?? ''));
      if (!command) return res.status(400).json({ error: 'No command configured' });
      if (/[\0\r\n]/.test(command) || args.some((a) => /[\0\r\n]/.test(a))) {
        return res.status(400).json({ error: 'Invalid characters in command' });
      }
      try {
        await launch(command, args);
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: `Could not start "${command}": ${err.message}` });
      }
    });
  },
};

export function launch(command, args) {
  const isUrl = /^https?:\/\//i.test(command);
  let file = command;
  let argv = args;
  const opts = { detached: true, stdio: 'ignore', shell: false };

  if (process.platform === 'win32') {
    // `start` resolves .lnk, URLs, documents and PATH programs the way Explorer does.
    const q = (s) => `"${String(s).replace(/"/g, '')}"`;
    file = 'cmd.exe';
    argv = ['/d', '/s', '/c', `start "" ${[command, ...args].map(q).join(' ')}`];
    opts.windowsVerbatimArguments = true;
    opts.windowsHide = true;
  } else if (isUrl) {
    file = process.platform === 'darwin' ? 'open' : 'xdg-open';
    argv = [command, ...args];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(file, argv, opts);
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/** Split an argument string, honouring "double" and 'single' quotes and \ escapes. */
export function splitArgs(input) {
  const out = [];
  let cur = '';
  let quote = null;
  let started = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && (input[i + 1] === '"' || input[i + 1] === '\\')) cur += input[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || cur) out.push(cur);
      cur = '';
      started = false;
    } else {
      cur += ch;
      started = true;
    }
  }
  if (started || cur) out.push(cur);
  return out;
}
