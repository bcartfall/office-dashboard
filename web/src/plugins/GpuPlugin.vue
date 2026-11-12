<script setup>
import { computed, toRef } from 'vue';
import { api } from '../api.js';
import { usePolling } from '../composables/usePolling.js';
import { useServerHistory } from '../composables/useServerHistory.js';
import { mb, pct, loadColor } from '../format.js';
import Sparkline from '../components/Sparkline.vue';
import ErrorLine from '../components/ErrorLine.vue';

const UTIL = '#a78bfa';
const MEM = '#34d399';

const props = defineProps({ config: { type: Object, required: true }, instanceId: { type: String, default: '' } });
const hist = useServerHistory(() => props.instanceId, () => props.config.historyPoints, 2);
const [util, vram] = hist.series;

const { data, error } = usePolling(async () => {
  const d = await api.get(`/plugins/gpu/data?index=${Number(props.config.gpuIndex) || 0}`);
  if (d.available) {
    const pctMem = d.memoryTotalMB && d.memoryUsedMB != null ? (d.memoryUsedMB / d.memoryTotalMB) * 100 : 0;
    await hist.sync([d.utilization ?? 0, pctMem]);
  }
  return d;
}, toRef(() => props.config.intervalSeconds));

const memPct = computed(() =>
  data.value?.memoryTotalMB && data.value.memoryUsedMB != null ? (data.value.memoryUsedMB / data.value.memoryTotalMB) * 100 : null
);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2">
    <div v-if="data && !data.available" class="flex flex-1 flex-col items-center justify-center gap-1 text-center text-sm text-zinc-500">
      <span>No GPU detected</span>
      <span class="text-xs">{{ data.reason }}</span>
    </div>
    <template v-else>
      <div class="flex items-end justify-between gap-3">
        <div>
          <div class="text-[11px] uppercase tracking-wide text-zinc-500">Utilization</div>
          <div class="text-3xl font-semibold tabular-nums leading-none" :style="{ color: data?.utilization != null ? loadColor(data.utilization) : '#71717a' }">
            {{ data?.utilization != null ? pct(data.utilization, 0) : '–' }}
          </div>
        </div>
        <div v-if="data" class="min-w-0 text-right text-[11px] leading-tight text-zinc-500">
          <div class="truncate" :title="data.name">{{ data.name }}</div>
          <div v-if="data.temperature != null">{{ data.temperature }}°C</div>
        </div>
      </div>
      <div class="min-h-10 flex-1">
        <Sparkline :series="[{ values: util, color: UTIL }]" :capacity="config.historyPoints" :max="100" />
      </div>
      <div class="flex items-center justify-between text-xs tabular-nums text-zinc-300">
        <span class="flex items-center gap-1.5"><i class="inline-block size-2 rounded-full" :style="{ background: MEM }" />Dedicated memory</span>
        <span v-if="data?.memoryTotalMB">{{ data.memoryUsedMB != null ? mb(data.memoryUsedMB) : '–' }} / {{ mb(data.memoryTotalMB) }}</span>
        <span v-else class="text-zinc-500">not reported</span>
      </div>
      <div class="min-h-10 flex-1">
        <Sparkline :series="[{ values: vram, color: MEM }]" :capacity="config.historyPoints" :max="100" />
      </div>
    </template>
    <ErrorLine :message="error" />
  </div>
</template>
