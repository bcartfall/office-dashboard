import si from 'systeminformation';
import { cached } from '../lib/cache.js';

export default {
  id: 'memory',
  name: 'Memory',
  description: 'RAM in use and available',
  routes(router) {
    router.get('/data', async (_req, res) => {
      const m = await cached('mem', 900, () => si.mem());
      // "available" already accounts for reclaimable cache, so used = total - available
      const available = m.available ?? m.free;
      const used = m.total - available;
      res.json({
        total: m.total,
        used,
        available,
        usedPercent: Math.round((used / m.total) * 1000) / 10,
        swapTotal: m.swaptotal,
        swapUsed: m.swapused,
      });
    });
  },
};
