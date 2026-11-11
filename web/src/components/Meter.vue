<script setup>
defineProps({
  value: { type: Number, default: 0 }, // 0-100
  color: { type: String, default: '#38bdf8' },
});
</script>

<template>
  <div class="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
    <div class="h-full rounded-full transition-all duration-500" :style="{ width: Math.min(100, Math.max(0, value)) + '%', background: color }" />
  </div>
</template>
