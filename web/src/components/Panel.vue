<script setup>
import { GripVertical, Trash2 } from 'lucide-vue-next';
import { dnd, movePlugin, addPlugin, removePlugin, removePanel } from '../store/layout.js';
import PluginCard from './PluginCard.vue';
import AddPluginMenu from './AddPluginMenu.vue';

const props = defineProps({
  panel: { type: Object, required: true },
  editing: Boolean,
});
const emit = defineEmits(['settings']);

function dropAtEnd(e) {
  if (!dnd.pluginId) return;
  e.preventDefault();
  e.stopPropagation();
  movePlugin(dnd.panelId, dnd.pluginId, props.panel.i, null);
  dnd.panelId = dnd.pluginId = dnd.overId = null;
}

function deletePanel() {
  if (!props.panel.plugins.length || confirm(`Delete panel “${props.panel.title}” and its ${props.panel.plugins.length} plugin(s)?`)) {
    removePanel(props.panel.i);
  }
}
</script>

<template>
  <section class="flex h-full flex-col rounded-2xl border border-zinc-800 bg-zinc-900/60 shadow-xl shadow-black/30 backdrop-blur">
    <!-- Drag handle = header (only active in edit mode) -->
    <header class="panel-handle flex select-none items-center gap-2 border-b border-zinc-800/80 px-3 py-2" :class="editing ? 'cursor-grab active:cursor-grabbing' : ''">
      <GripVertical v-if="editing" :size="16" class="shrink-0 text-zinc-600" aria-hidden="true" />
      <input
        v-if="editing"
        v-model="panel.title"
        class="min-w-0 flex-1 rounded bg-transparent px-1 text-sm font-semibold text-zinc-100 outline-none ring-sky-500/60 focus:bg-zinc-800 focus:ring-1"
        aria-label="Panel title"
        maxlength="60"
      />
      <h2 v-else class="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100">{{ panel.title }}</h2>
      <template v-if="editing">
        <AddPluginMenu @add="(type) => addPlugin(panel.i, type)" />
        <button class="rounded-lg p-1.5 text-zinc-500 hover:bg-red-500/15 hover:text-red-300" aria-label="Delete panel" title="Delete panel" @click.stop="deletePanel">
          <Trash2 :size="15" />
        </button>
      </template>
    </header>

    <!-- Plugin elements auto-fill the available space -->
    <div class="no-drag flex min-h-0 flex-1 flex-wrap content-stretch gap-3 overflow-auto p-3" @dragover="dnd.pluginId && $event.preventDefault()" @drop="dropAtEnd">
      <PluginCard
        v-for="(plugin, index) in panel.plugins"
        :key="plugin.id"
        :plugin="plugin"
        :panel-id="panel.i"
        :index="index"
        :editing="editing"
        @settings="emit('settings', panel, plugin)"
        @remove="removePlugin(panel.i, plugin.id)"
      />
      <div v-if="!panel.plugins.length" class="flex flex-1 items-center justify-center rounded-xl border border-dashed border-zinc-800 p-4 text-center text-sm text-zinc-600">
        {{ editing ? 'Use “+ Plugin” to add something, or drop one here.' : 'Empty panel — enable “Edit layout” to add plugins.' }}
      </div>
    </div>
  </section>
</template>
