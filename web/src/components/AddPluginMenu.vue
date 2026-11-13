<script setup>
import { ref, nextTick, onBeforeUnmount } from 'vue';
import { Plus } from 'lucide-vue-next';
import { plugins } from '../plugins/index.js';
import Icon from './Icon.vue';

const emit = defineEmits(['add']);
const open = ref(false);
const btn = ref(null);
const menu = ref(null);
const pos = ref({ top: 0, left: 0, maxHeight: 0 });
const MARGIN = 8;
const GAP = 6;

/**
 * Place the menu under the button, or above it when there is more room there (e.g. the button sits at the
 * bottom of the screen), and cap its height to the space available so it scrolls instead of running off-screen.
 */
function place() {
  if (!btn.value) return;
  const r = btn.value.getBoundingClientRect();
  const width = 280;
  const below = window.innerHeight - r.bottom - GAP - MARGIN;
  const above = r.top - GAP - MARGIN;
  const natural = menu.value?.scrollHeight ?? 0; // full height of the list, measured once it is rendered
  const flip = natural > below && above > below;
  const room = Math.max(120, flip ? above : below);
  const height = Math.min(natural || room, room);
  pos.value = {
    top: flip ? Math.max(MARGIN, r.top - GAP - height) : r.bottom + GAP,
    left: Math.max(MARGIN, Math.min(window.innerWidth - width - MARGIN, r.right - width)),
    maxHeight: room,
  };
}

function toggle() {
  if (open.value) return close();
  place();
  open.value = true;
  nextTick(() => {
    place(); // second pass with the real height
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
  });
}
function close() {
  open.value = false;
  document.removeEventListener('pointerdown', onOutside, true);
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', place);
  window.removeEventListener('scroll', place, true);
}
const onOutside = (e) => {
  if (!e.target.closest?.('[data-add-menu]') && !btn.value?.contains(e.target)) close();
};
const onKey = (e) => e.key === 'Escape' && close();
onBeforeUnmount(close);

function pick(type) {
  emit('add', type);
  close();
}
</script>

<template>
  <button
    ref="btn"
    class="flex items-center gap-1 rounded-lg bg-sky-500/15 px-2 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/25"
    aria-haspopup="menu"
    :aria-expanded="open"
    @click.stop="toggle"
  >
    <Plus :size="14" /> Plugin
  </button>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menu"
      data-add-menu
      role="menu"
      class="fixed z-50 w-70 overflow-y-auto overscroll-contain rounded-xl border border-zinc-700 bg-zinc-900 p-1 shadow-2xl"
      :style="{ top: pos.top + 'px', left: pos.left + 'px', maxHeight: pos.maxHeight + 'px' }"
    >
      <button
        v-for="(def, type) in plugins"
        :key="type"
        role="menuitem"
        class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-zinc-800"
        @click="pick(type)"
      >
        <Icon :name="def.icon" :size="18" class="text-sky-300" />
        <span class="min-w-0">
          <span class="block text-sm text-zinc-100">{{ def.name }}</span>
          <span class="block truncate text-xs text-zinc-500">{{ def.description }}</span>
        </span>
      </button>
    </div>
  </Teleport>
</template>
