<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { GridLayout, GridItem } from 'grid-layout-plus';
import { LayoutGrid, Pencil, Check, Plus, CloudOff } from 'lucide-vue-next';
import { state, load, addPanel } from './store/layout.js';
import Panel from './components/Panel.vue';
import SettingsModal from './components/SettingsModal.vue';

const settingsTarget = ref(null); // the plugin instance being configured
const openSettings = (_panel, plugin) => (settingsTarget.value = plugin);

// Header clock
const now = ref(new Date());
let tick;
onMounted(() => {
  load();
  tick = setInterval(() => (now.value = new Date()), 1000 * 15);
});
onBeforeUnmount(() => clearInterval(tick));
const time = computed(() => now.value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
const date = computed(() => now.value.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
</script>

<template>
  <div class="mx-auto max-w-[1800px] px-4 pb-10 pt-4 sm:px-6">
    <header class="mb-4 flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-2.5">
        <div class="grid size-9 place-items-center rounded-xl bg-sky-500/15 text-sky-300"><LayoutGrid :size="18" /></div>
        <div>
          <h1 class="text-lg font-semibold leading-tight text-zinc-100">{{ time }}</h1>
          <p class="text-xs leading-tight text-zinc-500">{{ date }}</p>
        </div>
      </div>

      <div class="ml-auto flex items-center gap-2">
        <span v-if="state.offline" class="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300" title="Changes are kept in this browser until the backend is reachable">
          <CloudOff :size="14" /> Backend offline
        </span>
        <template v-if="state.editing">
          <button class="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700" @click="addPanel"><Plus :size="15" /> Add panel</button>
        </template>
        <button
          class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition"
          :class="state.editing ? 'bg-sky-500 text-zinc-950 hover:bg-sky-400' : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'"
          :aria-pressed="state.editing"
          @click="state.editing = !state.editing"
        >
          <component :is="state.editing ? Check : Pencil" :size="15" />
          {{ state.editing ? 'Done' : 'Edit layout' }}
        </button>
      </div>
    </header>

    <GridLayout
      v-if="state.ready"
      v-model:layout="state.panels"
      :col-num="12"
      :row-height="40"
      :margin="[14, 14]"
      :is-draggable="state.editing"
      :is-resizable="state.editing"
      :vertical-compact="true"
      :use-css-transforms="true"
    >
      <template #item="{ item }">
        <Panel :panel="item" :editing="state.editing" @settings="openSettings" />
      </template>
    </GridLayout>
    <p v-else class="py-20 text-center text-sm text-zinc-600">Loading…</p>

    <SettingsModal v-if="settingsTarget" :plugin="settingsTarget" @close="settingsTarget = null" />
  </div>
</template>
