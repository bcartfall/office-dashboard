import { ref, unref, watch, onMounted, onBeforeUnmount } from 'vue';

/**
 * Poll `fetcher` every `interval` seconds (a number or ref; changes apply live).
 * Skips ticks while the tab is hidden and never overlaps two in-flight requests.
 *
 * Sleep/resume: after the computer wakes, the network (and DNS) usually needs a few seconds to come back, so
 * the first requests fail. A failed tick is therefore retried after a short back-off (2 s, 4 s, 8 s ... capped
 * at 15 s) instead of waiting a whole interval, and a tick is forced as soon as the browser reports it is
 * online again or the clock jumped (= the machine was asleep).
 */
export function usePolling(fetcher, interval, { onData } = {}) {
  const data = ref(null);
  const error = ref(null);
  let timer = null;
  let retryTimer = null;
  let failures = 0;
  let lastBeat = Date.now();
  let inflight = false;

  async function tick() {
    if (inflight) return;
    inflight = true;
    try {
      const result = await fetcher();
      data.value = result;
      error.value = null;
      failures = 0;
      onData?.(result);
    } catch (e) {
      error.value = e.message || String(e);
      failures++;
      clearTimeout(retryTimer);
      if (failures <= 6) retryTimer = setTimeout(tick, Math.min(15_000, 1000 * 2 ** failures)); // quick retry while the network reconnects
    } finally {
      inflight = false;
    }
  }

  function schedule() {
    clearInterval(timer);
    const seconds = Math.max(1, Number(unref(interval)) || 5);
    timer = setInterval(() => {
      const now = Date.now();
      const slept = now - lastBeat > seconds * 1000 * 2 + 5000; // timers don't fire while the machine sleeps
      lastBeat = now;
      if (slept) failures = 0;
      if (!document.hidden) tick();
    }, seconds * 1000);
  }

  // Catch up straight away when the tab comes back instead of waiting for the next interval.
  const onVisible = () => !document.hidden && tick();
  const onOnline = () => {
    failures = 0;
    if (!document.hidden) tick();
  };

  watch(() => unref(interval), schedule);
  onMounted(() => {
    tick();
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
  });
  onBeforeUnmount(() => {
    clearInterval(timer);
    clearTimeout(retryTimer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
  });

  return { data, error, refresh: tick };
}
