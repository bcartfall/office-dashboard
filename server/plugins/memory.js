import si from 'systeminformation';
import { cached } from '../lib/cache.js';
import { everySeconds, keepPoints } from '../lib/bg-config.js';

async function read() {
  const m = await cached('mem', 900, () => si.mem());
  // "available" already accounts for reclaimable cache, so used = total - available
  const available = m.available ?? m.free;
  const used = m.total - available;
  return {
    total: m.total,
    used,
    available,
    usedPercent: Math.round((used / m.total) * 1000) / 10,
    swapTotal: m.swaptotal,
    swapUsed: m.swapused,
  };
}

export default {
  id: 'memory',
  name: 'Memory',
  description: 'RAM in use and available',
  background: {
    interval: everySeconds,
    points: keepPoints,
    signature: () => '',
    run: async () => [(await read()).usedPercent],
  },
  routes(router) {
    router.get('/data', async (_req, res) => res.json(await read()));
  },
};
