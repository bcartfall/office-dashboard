<script setup>
import { reactive, computed, toRef } from 'vue';
import { api } from '../api.js';
import { usePolling, pushHistory } from '../composables/usePolling.js';
import { bytes, pct, loadColor } from '../format.js';
import Sparkline from '../components/Sparkline.vue';
import Meter from '../components/Meter.vue';
import ErrorLine from '../components/ErrorLine.vue';

const props = defineProps({ config: { type: Object, required: true } });
const history = reactive([]);

const { data, error } = usePolling(() => api.get('/plugins/memory/data'), toRef(() => props.config.intervalSeconds), {
  onData: (d) => pushHistory(history, d.usedPercent, props.config.historyPoints),
});

const color = computed(() => loadColor(data.value?.usedPercent ?? 0));
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2">
    <div class="flex items-end justify-between gap-3">
      <div>
        <div class="text-[11px] uppercase tracking-wide text-zinc-500">In use</div>
        <div class="text-3xl font-semibold tabular-nums leading-none" :style="{ color }">{{ data ? bytes(data.used) : '–' }}</div>
      </div>
      <div class="text-right">
        <div class="text-[11px] uppercase tracking-wide text-zinc-500">Available</div>
        <div class="text-lg font-medium tabular-nums leading-none text-zinc-200">{{ data ? bytes(data.available) : '–' }}</div>
      </div>
    </div>
    <Meter :value="data?.usedPercent ?? 0" :color="color" />
    <div class="flex justify-between text-[11px] text-zinc-500">
      <span>{{ data ? pct(data.usedPercent, 1) : '' }} of {{ data ? bytes(data.total) : '' }}</span>
      <span v-if="config.showSwap && data?.swapTotal">Swap {{ bytes(data.swapUsed) }} / {{ bytes(data.swapTotal) }}</span>
    </div>
    <div class="min-h-12 flex-1">
      <Sparkline :series="[{ values: history, color }]" :capacity="config.historyPoints" :max="100" />
    </div>
    <ErrorLine :message="error" />
  </div>
</template>
