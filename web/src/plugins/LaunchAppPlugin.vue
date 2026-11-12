<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { LoaderCircle } from 'lucide-vue-next';
import { api } from '../api.js';
import Icon from '../components/Icon.vue';
import { comboFromEvent, normalizeCombo, isTypingTarget } from '../hotkey.js';

const props = defineProps({ config: { type: Object, required: true }, instanceId: { type: String, default: '' } });
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

// Hotkey: active while the dashboard tab has focus (browsers don't allow global shortcuts to web pages).
function onKey(e) {
  const want = normalizeCombo(props.config.hotkey);
  if (!want || e.repeat || e.isComposing) return;
  if (isTypingTarget(document.activeElement) || document.querySelector('[role="dialog"]')) return; // typing, or a settings dialog is open
  if (normalizeCombo(comboFromEvent(e)) !== want) return;
  e.preventDefault();
  if (props.config.command?.trim()) launch();
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  clearTimeout(reset);
});
</script>

<template>
  <button
    type="button"
    class="group/tile relative flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
    :class="
      status === 'error'
        ? 'border-red-500/50 bg-red-500/10'
        : status === 'ok'
          ? 'border-emerald-500/50 bg-emerald-500/10'
          : 'border-zinc-800 bg-zinc-800/40 hover:border-sky-500/50 hover:bg-zinc-800'
    "
    :title="status === 'error' ? message : config.command ? `${config.command} ${config.args || ''}${config.hotkey ? `  (${config.hotkey})` : ''}` : 'Click to configure'"
    :aria-keyshortcuts="config.hotkey || undefined"
    @click="launch"
  >
    <kbd
      v-if="config.hotkey"
      class="pointer-events-none absolute right-1.5 top-1.5 max-w-[70%] truncate rounded border border-zinc-700 bg-zinc-950/70 px-1.5 py-px font-sans text-[10px] font-medium leading-4 text-zinc-400"
    >{{ config.hotkey }}</kbd>
    <LoaderCircle v-if="status === 'busy'" :size="26" class="animate-spin text-sky-300" />
    <Icon v-else :name="config.icon" :size="26" class="text-sky-300 transition group-hover/tile:scale-110" />
    <span class="max-w-full truncate text-sm font-medium text-zinc-200">{{ config.title }}</span>
    <span v-if="status === 'error'" class="max-w-full truncate text-[10px] text-red-300">{{ message }}</span>
    <span v-else-if="!config.command" class="text-[10px] text-amber-300/80">Set a command</span>
  </button>
</template>
