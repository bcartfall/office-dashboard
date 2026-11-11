<script setup>
import { computed } from 'vue';
import { iconMap } from '../icons.js';

const props = defineProps({
  name: { type: String, default: '' },
  size: { type: Number, default: 18 },
});

const resolved = computed(() => {
  const n = (props.name || '').trim();
  const lib = iconMap[n.toLowerCase()];
  if (lib) return { kind: 'svg', component: lib };
  if (/^(https?:\/\/|data:image\/)/i.test(n)) return { kind: 'img', src: n };
  // short strings / non-ASCII = emoji; an unknown word falls back to the puzzle icon
  if (n && (n.length <= 4 || /[^\x00-\x7f]/.test(n))) return { kind: 'text', text: n };
  return { kind: 'svg', component: iconMap.puzzle };
});
</script>

<template>
  <component :is="resolved.component" v-if="resolved.kind === 'svg'" :size="size" :stroke-width="1.75" class="shrink-0" />
  <img
    v-else-if="resolved.kind === 'img'"
    :src="resolved.src"
    :width="size"
    :height="size"
    alt=""
    class="shrink-0 rounded object-contain"
    :style="{ width: size + 'px', height: size + 'px' }"
  />
  <span v-else class="shrink-0 text-center leading-none" :style="{ fontSize: size * 0.9 + 'px', width: size + 'px' }">{{
    resolved.text
  }}</span>
</template>
