import si from 'systeminformation';
import { cached } from '../lib/cache.js';

const controllers = () =>
  cached('gpu', 900, async () => {
    const g = await si.graphics();
    return g.controllers || [];
  });

export default {
  id: 'gpu',
  name: 'GPU',
  description: 'GPU utilisation and dedicated memory',
  routes(router) {
    router.get('/list', async (_req, res) => {
      const list = await controllers();
      res.json(list.map((c, index) => ({ index, name: c.model || `GPU ${index}` })));
    });

    router.get('/data', async (req, res) => {
      const list = await controllers();
      const index = Math.max(0, Number.parseInt(req.query.index, 10) || 0);
      const c = list[index];
      if (!c) {
        return res.json({ available: false, count: list.length, reason: 'No GPU found at this index' });
      }
      // Utilisation / memory-used are only reported by drivers that expose them (NVIDIA works everywhere).
      const memTotal = num(c.memoryTotal) ?? num(c.vram);
      const memUsed = num(c.memoryUsed);
      res.json({
        available: true,
        count: list.length,
        name: c.model,
        vendor: c.vendor,
        utilization: num(c.utilizationGpu),
        memoryUtilization: num(c.utilizationMemory),
        memoryTotalMB: memTotal,
        memoryUsedMB: memUsed,
        temperature: num(c.temperatureGpu),
      });
    });
  },
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
