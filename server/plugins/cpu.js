import si from 'systeminformation';
import { cached } from '../lib/cache.js';

export default {
  id: 'cpu',
  name: 'CPU Load',
  description: 'Total and per-core CPU utilisation',
  routes(router) {
    router.get('/data', async (_req, res) => {
      const [load, cpu, temp] = await Promise.all([
        cached('cpu:load', 900, () => si.currentLoad()),
        cached('cpu:info', 60_000, () => si.cpu()),
        cached('cpu:temp', 3000, () => si.cpuTemperature().catch(() => ({}))),
      ]);
      res.json({
        load: round(load.currentLoad),
        user: round(load.currentLoadUser),
        system: round(load.currentLoadSystem),
        cores: (load.cpus || []).map((c) => round(c.load)),
        name: `${cpu.manufacturer} ${cpu.brand}`.trim(),
        speedGHz: cpu.speed,
        coreCount: cpu.cores,
        temperature: temp?.main ?? null,
      });
    });
  },
};

const round = (n) => Math.round((Number(n) || 0) * 10) / 10;
