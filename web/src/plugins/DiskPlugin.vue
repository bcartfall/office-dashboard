<script setup>
import { computed, toRef } from 'vue';
import { api } from '../api.js';
import { usePolling } from '../composables/usePolling.js';
import { useServerHistory } from '../composables/useServerHistory.js';
import { bytes, rate, pct, loadColor } from '../format.js';
import Sparkline from '../components/Sparkline.vue';
import Meter from '../components/Meter.vue';
import ErrorLine from '../components/ErrorLine.vue';

const READ = '#38bdf8';
const WRITE = '#fb923c';

const props = defineProps({ config: { type: Object, required: true }, instanceId: { type: String, default: '' } });
const hist = useServerHistory(() => props.instanceId, () => props.config.historyPoints, 2);
const [reads, writes] = hist.series;

const { data, error } = usePolling(async () => {
  const d = await api.get(`/plugins/disk/data?mount=${encodeURIComponent(props.config.mount || '')}`);
  await hist.sync([d.readBytesPerSec, d.writeBytesPerSec]);
  return d;
}, toRef(() => props.config.intervalSeconds));

const color = computed(() => loadColor(data.value?.usedPercent ?? 0));
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2">
    <div class="flex items-end justify-between gap-3">
      <div>
        <div class="text-[11px] uppercase tracking-wide text-zinc-500">Used · {{ data?.mount ?? '' }}</div>
        <div class="text-3xl font-semibold tabular-nums leading-none" :style="{ color }">{{ data ? pct(data.usedPercent, 0) : '–' }}</div>
      </div>
      <div class="text-right text-[11px] leading-tight text-zinc-500">
        <div v-if="data">{{ bytes(data.used) }} of {{ bytes(data.size) }}</div>
        <div v-if="data" class="truncate">{{ data.fs }}</div>
      </div>
    </div>
    <Meter :value="data?.usedPercent ?? 0" :color="color" />
    <div class="flex justify-between text-xs tabular-nums">
      <span class="flex items-center gap-1.5 text-zinc-300"><i class="inline-block size-2 rounded-full" :style="{ background: READ }" />Read {{ data ? rate(data.readBytesPerSec) : '–' }}</span>
      <span class="flex items-center gap-1.5 text-zinc-300"><i class="inline-block size-2 rounded-full" :style="{ background: WRITE }" />Write {{ data ? rate(data.writeBytesPerSec) : '–' }}</span>
    </div>
    <div class="min-h-12 flex-1">
      <Sparkline
        :series="[
          { values: reads, color: READ },
          { values: writes, color: WRITE },
        ]"
        :capacity="config.historyPoints"
      />
    </div>
    <ErrorLine :message="error" />
  </div>
</template>
