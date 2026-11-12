import si from 'systeminformation';
import { cached } from '../lib/cache.js';
import { everySeconds, keepPoints } from '../lib/bg-config.js';

const controllers = () =>
  cached('gpu', 900, async () => {
    const g = await si.graphics();
    return g.controllers || [];
  });

export default {
  id: 'gpu',
  name: 'GPU',
  description: 'GPU utilisation and dedicated memory',
  background: {
    interval: everySeconds,
    points: keepPoints,
    signature: (config) => String(Number(config?.gpuIndex) || 0),
    run: async (config) => {
      const d = await read(Number(config?.gpuIndex) || 0);
      if (!d.available) return undefined; // nothing to record
      const memPct = d.memoryTotalMB && d.memoryUsedMB != null ? (d.memoryUsedMB / d.memoryTotalMB) * 100 : 0;
      return [d.utilization ?? 0, memPct];
    },
  },
  routes(router) {
    router.get('/list', async (_req, res) => {
      const list = await controllers();
      res.json(list.map((c, index) => ({ index, name: c.model || `GPU ${index}` })));
    });

    router.get('/data', async (req, res) => res.json(await read(Number.parseInt(req.query.index, 10) || 0)));
  },
};

async function read(rawIndex) {
  const list = await controllers();
  const index = Math.max(0, rawIndex);
  const c = list[index];
  if (!c) return { available: false, count: list.length, reason: 'No GPU found at this index' };
  // Utilisation / memory-used are only reported by drivers that expose them (NVIDIA works everywhere).
  return {
    available: true,
    count: list.length,
    name: c.model,
    vendor: c.vendor,
    utilization: num(c.utilizationGpu),
    memoryUtilization: num(c.utilizationMemory),
    memoryTotalMB: num(c.memoryTotal) ?? num(c.vram),
    memoryUsedMB: num(c.memoryUsed),
    temperature: num(c.temperatureGpu),
  };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
