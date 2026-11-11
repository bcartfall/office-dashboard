<script setup>
import { ref } from 'vue';
import { LoaderCircle } from 'lucide-vue-next';
import { api } from '../api.js';
import Icon from '../components/Icon.vue';

const props = defineProps({ config: { type: Object, required: true } });
const emit = defineEmits(['configure']);

const status = ref('idle'); // idle | busy | ok | error
const message = ref('');
let reset;

async function launch() {
  if (!props.config.command?.trim()) return emit('configure');
  clearTimeout(reset);
  status.value = 'busy';
  try {
    await api.post('/plugins/launch-app/run', { command: props.config.command, args: props.config.args });
    status.value = 'ok';
    message.value = '';
  } catch (e) {
    status.value = 'error';
    message.value = e.message;
  }
  reset = setTimeout(() => (status.value = 'idle'), status.value === 'error' ? 5000 : 1500);
}
</script>

<template>
  <button
    type="button"
    class="group/tile flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
    :class="
      status === 'error'
        ? 'border-red-500/50 bg-red-500/10'
        : status === 'ok'
          ? 'border-emerald-500/50 bg-emerald-500/10'
          : 'border-zinc-800 bg-zinc-800/40 hover:border-sky-500/50 hover:bg-zinc-800'
    "
    :title="status === 'error' ? message : config.command ? `${config.command} ${config.args || ''}` : 'Click to configure'"
    @click="launch"
  >
    <LoaderCircle v-if="status === 'busy'" :size="26" class="animate-spin text-sky-300" />
    <Icon v-else :name="config.icon" :size="26" class="text-sky-300 transition group-hover/tile:scale-110" />
    <span class="max-w-full truncate text-sm font-medium text-zinc-200">{{ config.title }}</span>
    <span v-if="status === 'error'" class="max-w-full truncate text-[10px] text-red-300">{{ message }}</span>
    <span v-else-if="!config.command" class="text-[10px] text-amber-300/80">Set a command</span>
  </button>
</template>
