<script setup>
import { X } from 'lucide-vue-next';
import { comboFromEvent } from '../hotkey.js';

/** Click, then press the shortcut you want. Backspace/Delete clears it. */
const model = defineModel({ type: String, default: '' });
defineProps({ placeholder: { type: String, default: 'Click and press a key…' } });

function onKeydown(e) {
  if (e.key === 'Tab' || e.key === 'Escape') return; // keep keyboard navigation and "Esc closes the dialog"
  e.preventDefault();
  e.stopPropagation();
  if ((e.key === 'Backspace' || e.key === 'Delete') && !(e.ctrlKey || e.altKey || e.metaKey)) {
    model.value = '';
    return;
  }
  const combo = comboFromEvent(e);
  if (combo) model.value = combo;
}
</script>

<template>
  <div class="relative">
    <input
      :value="model"
      readonly
      :placeholder="placeholder"
      class="w-full cursor-pointer rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 pr-9 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500"
      @keydown="onKeydown"
    />
    <button v-if="model" type="button" class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Clear shortcut" @click="model = ''"><X :size="14" /></button>
  </div>
</template>
