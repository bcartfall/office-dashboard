import { ref, unref, watch, onMounted, onBeforeUnmount } from 'vue';

/**
 * Poll `fetcher` every `interval` seconds (a number or ref; changes apply live).
 * Skips ticks while the tab is hidden and never overlaps two in-flight requests.
 */
export function usePolling(fetcher, interval, { onData } = {}) {
  const data = ref(null);
  const error = ref(null);
  let timer = null;
  let inflight = false;

  async function tick() {
    if (inflight) return;
    inflight = true;
    try {
      const result = await fetcher();
      data.value = result;
      error.value = null;
      onData?.(result);
    } catch (e) {
      error.value = e.message || String(e);
    } finally {
      inflight = false;
    }
  }

  function schedule() {
    clearInterval(timer);
    const seconds = Math.max(1, Number(unref(interval)) || 5);
    timer = setInterval(() => {
      if (!document.hidden) tick();
    }, seconds * 1000);
  }

  // Catch up straight away when the tab comes back instead of waiting for the next interval.
  const onVisible = () => !document.hidden && tick();

  watch(() => unref(interval), schedule);
  onMounted(() => {
    tick();
    schedule();
    document.addEventListener('visibilitychange', onVisible);
  });
  onBeforeUnmount(() => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  });

  return { data, error, refresh: tick };
}
