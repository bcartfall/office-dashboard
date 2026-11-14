<script setup>
import { computed, toRef } from 'vue';
import { ArrowDown, ArrowUp } from 'lucide-vue-next';
import { api } from '../api.js';
import { usePolling } from '../composables/usePolling.js';
import { useServerHistory } from '../composables/useServerHistory.js';
import { rate } from '../format.js';
import Sparkline from '../components/Sparkline.vue';
import Meter from '../components/Meter.vue';
import ErrorLine from '../components/ErrorLine.vue';

const DOWN = '#38bdf8';
const UP = '#fb923c';

const props = defineProps({ config: { type: Object, required: true }, instanceId: { type: String, default: '' } });
// Adapter graph = download/upload of the chosen network device (bytes/s), sampled by the server around the clock.
const hist = useServerHistory(() => props.instanceId, () => props.config.historyPoints, 2);
const [downs, ups] = hist.series;

const { data, error } = usePolling(async () => {
  const q = new URLSearchParams({ iface: props.config.iface || '', test: String(props.config.testMinutes ?? 30) });
  const d = await api.get(`/plugins/network/data?${q}`);
  const l = d.lan;
  await hist.sync(l?.rxBytesPerSec != null ? [l.rxBytesPerSec, l.txBytesPerSec ?? 0] : null);
  return d;
}, toRef(() => props.config.intervalSeconds));

const lan = computed(() => data.value?.lan ?? null);
const net = computed(() => data.value?.internet ?? null);

const speed = (m) => (m == null ? '–' : m >= 1000 ? `${(m / 1000).toFixed(2)} Gbit/s` : `${m >= 100 ? Math.round(m) : m.toFixed(1)} Mbit/s`);
const ms = (v) => (v == null ? '–' : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`);
const live = (v) => (v == null ? '–' : rate(v));

// Share of the link in use (by the larger of the two directions - the link is full duplex).
const linkUse = computed(() => {
  const l = lan.value;
  if (!l?.linkMbps || l.rxBytesPerSec == null) return 0;
  const bits = Math.max(l.rxBytesPerSec, l.txBytesPerSec ?? 0) * 8;
  return (bits / (l.linkMbps * 1e6)) * 100;
});

// Internet graph = the speed-test results the server has kept (Mbit/s).
const testDowns = computed(() => (net.value?.history ?? []).map((r) => r.down));
const testUps = computed(() => (net.value?.history ?? []).map((r) => r.up ?? 0));

const ago = computed(() => {
  const t = net.value?.testedAt;
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
});
const testsOff = computed(() => !(Number(props.config.testMinutes) > 0));
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <!-- LAN -->
    <section class="space-y-1.5" aria-label="LAN">
      <div class="flex items-baseline justify-between gap-2">
        <h4 class="text-[11px] font-medium uppercase tracking-wide text-zinc-500">LAN</h4>
        <span class="min-w-0 truncate text-[11px] text-zinc-500" :title="lan ? `${lan.iface || ''} ${lan.description || ''}`.trim() : ''">
          <template v-if="lan">{{ lan.iface || 'No adapter' }}<template v-if="lan.description && lan.description !== lan.iface"> ({{ lan.description }})</template></template>
        </span>
      </div>
      <div class="flex items-end justify-between gap-3">
        <div class="text-2xl font-semibold tabular-nums leading-none text-zinc-100" title="Negotiated link speed of the adapter">{{ lan ? speed(lan.linkMbps) : '–' }}</div>
        <div class="text-right text-[11px] leading-tight text-zinc-500">
          <div v-if="lan?.gateway" title="Round-trip time to your router">router {{ ms(lan.latencyMs) }}</div>
        </div>
      </div>
      <Meter :value="linkUse" :color="DOWN" />
      <div class="flex justify-between text-xs tabular-nums text-zinc-300">
        <span class="flex items-center gap-1" :style="{ color: DOWN }" title="Download"><ArrowDown :size="12" /><span class="text-zinc-300">{{ lan ? live(lan.rxBytesPerSec) : '–' }}</span></span>
        <span class="flex items-center gap-1" :style="{ color: UP }" title="Upload"><ArrowUp :size="12" /><span class="text-zinc-300">{{ lan ? live(lan.txBytesPerSec) : '–' }}</span></span>
      </div>
      <div class="h-14">
        <Sparkline
          :series="[
            { values: downs, color: DOWN },
            { values: ups, color: UP },
          ]"
          :capacity="config.historyPoints"
        />
      </div>
      <p v-if="lan && !lan.found" class="text-[11px] text-amber-300/80">Network device “{{ lan.iface }}” was not found - pick another in the settings.</p>
    </section>

    <div class="border-t border-zinc-800" />

    <!-- Internet -->
    <section class="flex min-h-0 flex-1 flex-col gap-1.5" aria-label="Internet">
      <div class="flex items-baseline justify-between gap-2">
        <h4 class="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Internet</h4>
        <span class="text-[11px] text-zinc-500">
          <template v-if="net?.testing">testing…</template>
          <template v-else-if="ago">tested {{ ago }}</template>
          <template v-else-if="testsOff">speed test off</template>
        </span>
      </div>
      <div class="flex items-end justify-between gap-3">
        <div class="flex flex-wrap gap-x-4 gap-y-1 whitespace-nowrap text-xl font-semibold tabular-nums leading-none">
          <span class="flex items-center gap-1" :style="{ color: DOWN }" title="Download"><ArrowDown :size="16" />{{ speed(net?.downMbps) }}</span>
          <span class="flex items-center gap-1" :style="{ color: UP }" title="Upload"><ArrowUp :size="16" />{{ speed(net?.upMbps) }}</span>
        </div>
        <div v-if="net" class="text-right text-[11px] leading-tight text-zinc-500" title="Round-trip time to a public host">ping {{ ms(net.latencyMs) }}</div>
      </div>
      <div class="min-h-10 flex-1">
        <Sparkline
          :series="[
            { values: testDowns, color: DOWN },
            { values: testUps, color: UP },
          ]"
          :capacity="48"
        />
      </div>
      <p v-if="net?.error" class="text-[11px] text-amber-300/80">{{ net.error }}</p>
    </section>
    <ErrorLine :message="error" />
  </div>
</template>
