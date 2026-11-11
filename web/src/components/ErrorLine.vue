<script setup>
defineProps({ message: String });
</script>

<template>
  <p v-if="message" class="truncate rounded bg-red-500/10 px-2 py-1 text-xs text-red-300" :title="message">⚠ {{ message }}</p>
</template>
