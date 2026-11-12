<script setup>
import { computed, toRef } from 'vue';
import { api } from '../api.js';
import { usePolling } from '../composables/usePolling.js';
import { useServerHistory } from '../composables/useServerHistory.js';
import { pct, loadColor } from '../format.js';
import Sparkline from '../components/Sparkline.vue';
import ErrorLine from '../components/ErrorLine.vue';

const props = defineProps({ config: { type: Object, required: true }, instanceId: { type: String, default: '' } });
const hist = useServerHistory(() => props.instanceId, () => props.config.historyPoints, 1);
const [history] = hist.series;

const { data, error } = usePolling(async () => {
  const d = await api.get('/plugins/cpu/data');
  await hist.sync([d.load]);
  return d;
}, toRef(() => props.config.intervalSeconds));

const load = computed(() => data.value?.load ?? 0);
const color = computed(() => loadColor(load.value));
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2">
    <div class="flex items-end justify-between gap-3">
      <div class="text-3xl font-semibold tabular-nums leading-none" :style="{ color }">{{ data ? pct(load, 0) : '–' }}</div>
      <div v-if="data" class="min-w-0 text-right text-[11px] leading-tight text-zinc-500">
        <div class="truncate" :title="data.name">{{ data.name }}</div>
        <div>
          {{ data.coreCount }} threads · {{ data.speedGHz }} GHz<span v-if="data.temperature != null"> · {{ Math.round(data.temperature) }}°C</span>
        </div>
      </div>
    </div>
    <div class="min-h-14 flex-1">
      <Sparkline :series="[{ values: history, color }]" :capacity="config.historyPoints" :max="100" />
    </div>
    <div v-if="config.showCores && data?.cores?.length" class="flex h-6 items-end gap-0.5" aria-label="Per-core load">
      <div v-for="(c, i) in data.cores" :key="i" class="flex-1 rounded-sm bg-zinc-800" :title="`Core ${i}: ${c}%`" style="height: 100%; position: relative">
        <div class="absolute inset-x-0 bottom-0 rounded-sm transition-all duration-500" :style="{ height: Math.max(4, c) + '%', background: loadColor(c) }" />
      </div>
    </div>
    <ErrorLine :message="error" />
  </div>
</template>
