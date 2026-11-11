<script setup>
import { computed, useId } from 'vue';

/**
 * Stretchy SVG line/area chart that fills its parent.
 * series: [{ values: number[], color: string }]  (newest value last)
 * capacity: number of samples that span the full width (history length)
 * max: fixed y-max (e.g. 100 for percent) or null for "nice" auto-scaling
 */
const props = defineProps({
  series: { type: Array, required: true },
  capacity: { type: Number, default: 60 },
  max: { type: Number, default: null },
});

const uid = useId();
const W = 100;
const H = 100;

const yMax = computed(() => {
  if (props.max) return props.max;
  let m = 0;
  for (const s of props.series) for (const v of s.values) if (v > m) m = v;
  if (m <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(m));
  const f = m / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
});

const paths = computed(() =>
  props.series.map((s) => {
    const n = Math.max(2, props.capacity);
    const start = n - s.values.length;
    const pts = s.values.map((v, i) => {
      const x = ((start + i) / (n - 1)) * W;
      const y = H - Math.min(1, Math.max(0, v / yMax.value)) * H;
      return [x, y];
    });
    if (!pts.length) return { line: '', area: '', color: s.color };
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
    const area = `${line} L${pts.at(-1)[0].toFixed(2)} ${H} L${pts[0][0].toFixed(2)} ${H} Z`;
    return { line, area, color: s.color };
  })
);
</script>

<template>
  <!-- svg is absolutely positioned so its viewBox aspect ratio can't force the parent taller -->
  <div class="relative h-full w-full min-h-0">
  <svg
    class="absolute inset-0 block h-full w-full rounded-md bg-zinc-950/40"
    :viewBox="`0 0 ${W} ${H}`"
    preserveAspectRatio="none"
    role="img"
    aria-label="History graph"
  >
    <defs>
      <linearGradient v-for="(p, i) in paths" :id="`${uid}-g${i}`" :key="i" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="p.color" stop-opacity="0.35" />
        <stop offset="100%" :stop-color="p.color" stop-opacity="0" />
      </linearGradient>
    </defs>
    <line v-for="g in [25, 50, 75]" :key="g" x1="0" :y1="g" :x2="W" :y2="g" stroke="#fff" stroke-opacity="0.06" vector-effect="non-scaling-stroke" />
    <template v-for="(p, i) in paths" :key="i">
      <path v-if="p.area" :d="p.area" :fill="`url(#${uid}-g${i})`" />
      <path v-if="p.line" :d="p.line" fill="none" :stroke="p.color" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
    </template>
  </svg>
  </div>
</template>
