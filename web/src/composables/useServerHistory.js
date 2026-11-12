import { reactive } from 'vue';
import { api } from '../api.js';

/**
 * Graph history that lives on the server (it keeps sampling while no browser is open).
 *
 *   const h = useServerHistory(() => props.instanceId, () => props.config.historyPoints, 2);
 *   // in the polling fetcher, after loading live data:
 *   await h.sync([readBytes, writeBytes]);          // live values: only used if the server isn't tracking yet
 *   h.series[0], h.series[1]                        // reactive number[] per graph line, newest last
 *
 * The first sync downloads everything recorded so far, so the graph is full on page load; later syncs
 * fetch only what's new, which also fills in the gap after a hidden/backgrounded tab.
 * If the server isn't tracking this instance yet (just added, or backend too old), samples are collected locally.
 */
export function useServerHistory(getId, getCapacity, lines) {
  const series = Array.from({ length: lines }, () => reactive([]));
  let epoch = null;
  let lastT = 0;

  const cap = () => Math.max(10, Number(getCapacity()) || 60);
  const trim = () => {
    for (const s of series) if (s.length > cap()) s.splice(0, s.length - cap());
  };
  const reset = () => series.forEach((s) => s.splice(0, s.length));

  async function fetchHistory(id, since) {
    return api.get(`/history/${encodeURIComponent(id)}${since != null ? `?since=${since}` : ''}`);
  }

  async function sync(live) {
    const id = getId();
    let r = null;
    if (id) {
      try {
        r = await fetchHistory(id, epoch == null ? null : lastT);
        if (r.tracked && epoch != null && r.epoch !== epoch) r = await fetchHistory(id, null); // history was reset server-side
      } catch {
        r = null;
      }
    }

    if (r?.tracked) {
      if (r.epoch !== epoch) {
        reset();
        epoch = r.epoch;
        lastT = 0;
      }
      for (const sample of r.samples) {
        if (sample.t <= lastT) continue;
        lastT = sample.t;
        series.forEach((s, i) => s.push(Number(sample.v[i]) || 0));
      }
    } else if (Array.isArray(live)) {
      if (epoch != null) {
        reset(); // lost the server record (e.g. instance removed/re-added): start over
        epoch = null;
        lastT = 0;
      }
      series.forEach((s, i) => s.push(Number(live[i]) || 0));
    }
    trim();
  }

  return { series, sync };
}
