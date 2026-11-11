/**
 * Coalesce expensive system queries. Several plugin instances (or browser tabs)
 * may poll the same metric at different intervals; systeminformation computes
 * load/throughput as a delta between calls, so hammering it gives noisy numbers.
 */
const entries = new Map();

export function cached(key, ttlMs, fn) {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && now - hit.at < ttlMs) return hit.promise;
  const promise = Promise.resolve().then(fn);
  entries.set(key, { at: now, promise });
  promise.catch(() => entries.delete(key));
  return promise;
}
