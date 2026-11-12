import si from 'systeminformation';
import { execFile } from 'node:child_process';
import { cached } from '../lib/cache.js';
import { everySeconds, keepPoints } from '../lib/bg-config.js';

const volumes = () => cached('disk:fs', 5000, () => si.fsSize());

export default {
  id: 'disk',
  name: 'Disk',
  description: 'Disk usage plus read/write throughput',
  background: {
    interval: everySeconds,
    points: keepPoints,
    signature: (config) => String(config?.mount || ''), // another volume = a different graph
    run: async (config) => {
      const d = await read(String(config?.mount || ''));
      return [d.readBytesPerSec, d.writeBytesPerSec];
    },
  },
  routes(router) {
    // Used to populate the "mount" picker in the plugin settings.
    router.get('/mounts', async (_req, res) => {
      const fsList = await volumes();
      res.json(fsList.map((d) => ({ mount: d.mount, fs: d.fs, size: d.size })));
    });

    router.get('/data', async (req, res) => res.json(await read(typeof req.query.mount === 'string' ? req.query.mount : '')));
  },
};

const IS_WIN = process.platform === 'win32';

async function read(mount) {
  const fsList = await volumes();

  const vol =
    (mount && fsList.find((d) => d.mount === mount)) ||
    fsList.find((d) => d.mount === '/' || d.mount === 'C:') ||
    fsList[0];

  // Windows reports throughput per drive letter; elsewhere it is machine-wide.
  const ioKey = IS_WIN ? vol?.mount ?? '' : '';
  const io = await cached(`disk:io:${ioKey}`, 900, () => readIo(ioKey));

  return {
    mount: vol?.mount ?? null,
    fs: vol?.fs ?? null,
    size: vol?.size ?? 0,
    used: vol?.used ?? 0,
    usedPercent: Math.round((vol?.use ?? 0) * 10) / 10,
    readBytesPerSec: io.read,
    writeBytesPerSec: io.write,
  };
}

// systeminformation's fsStats()/disksIO() are not implemented on Windows (they
// resolve to null), which is why read/write used to be stuck at 0 B/s there.
// Windows reads the OS performance counters through WMI instead. The WMI class
// and property names are not localised, unlike `Get-Counter` paths.
function readWindowsIo(mount) {
  const drive = /^[A-Za-z]:$/.test(mount) ? mount.toUpperCase() : null;
  const cls = drive ? 'LogicalDisk' : 'PhysicalDisk';
  const name = drive || '_Total';
  const script =
    `Get-CimInstance Win32_PerfFormattedData_PerfDisk_${cls} -Filter "Name='${name}'" | ` +
    'Select-Object DiskReadBytesPerSec,DiskWriteBytesPerSec | ConvertTo-Json -Compress';
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 6000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const row = JSON.parse(String(stdout).trim());
          resolve({ read: Number(row.DiskReadBytesPerSec) || 0, write: Number(row.DiskWriteBytesPerSec) || 0 });
        } catch {
          resolve(null);
        }
      }
    );
  });
}

// Linux/macOS throughput is a delta since the previous call, so the very first
// sample is null; prime it at startup so the first dashboard request has data.
if (!IS_WIN) si.fsStats().catch(() => {});

async function readIo(mount) {
  if (IS_WIN) return (await readWindowsIo(mount)) ?? { read: 0, write: 0 };
  const stats = await si.fsStats().catch(() => null);
  if (stats && stats.rx_sec != null) return { read: stats.rx_sec, write: stats.wx_sec ?? 0 };
  const io = await si.disksIO().catch(() => null);
  return { read: io?.rIO_sec ?? 0, write: io?.wIO_sec ?? 0 };
}
