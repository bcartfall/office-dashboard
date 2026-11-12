<script setup>
import { computed } from 'vue';
import { Settings, Trash2, GripVertical } from 'lucide-vue-next';
import { plugins as registry } from '../plugins/index.js';
import { dnd, movePlugin } from '../store/layout.js';
import Icon from './Icon.vue';

const props = defineProps({
  plugin: { type: Object, required: true },
  panelId: { type: String, required: true },
  index: { type: Number, required: true },
  editing: Boolean,
});
const emit = defineEmits(['settings', 'remove']);

const def = computed(() => registry[props.plugin.type]);
const isTile = computed(() => def.value?.kind === 'tile');
const dragOver = computed(() => dnd.overId === props.plugin.id && dnd.pluginId !== props.plugin.id);

function onDragStart(e) {
  dnd.panelId = props.panelId;
  dnd.pluginId = props.plugin.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', props.plugin.id);
}
function onDragEnd() {
  dnd.panelId = dnd.pluginId = dnd.overId = null;
}
function onDragOver(e) {
  if (!dnd.pluginId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  dnd.overId = props.plugin.id;
}
function onDrop(e) {
  if (!dnd.pluginId) return;
  e.preventDefault();
  e.stopPropagation(); // don't also trigger the panel-level "append" drop
  movePlugin(dnd.panelId, dnd.pluginId, props.panelId, props.index);
  onDragEnd();
}
</script>

<template>
  <!-- Unknown plugin type (e.g. removed from the registry) -->
  <div v-if="!def" class="group relative flex flex-1 basis-60 items-center justify-between rounded-xl border border-dashed border-red-500/40 p-3 text-sm text-red-300">
    <span>Unknown plugin “{{ plugin.type }}”</span>
    <button class="rounded p-1 hover:bg-red-500/20" aria-label="Remove" @click="emit('remove')"><Trash2 :size="14" /></button>
  </div>

  <div
    v-else
    class="group relative min-w-0 rounded-xl transition"
    :class="[
      isTile ? 'self-start' : 'border border-zinc-800/80 bg-zinc-900/70 p-3',
      dragOver ? 'ring-2 ring-sky-400/70' : '',
      dnd.pluginId === plugin.id ? 'opacity-40' : '',
    ]"
    :style="
      isTile
        ? { flex: '1 1 118px', maxWidth: '220px', minHeight: '84px', maxHeight: '130px' }
        : { flex: `1 1 ${def.basis ?? 250}px`, minHeight: (def.minHeight ?? 190) + 'px', display: 'flex', flexDirection: 'column' }
    "
    :draggable="editing"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <!-- Widget header: icon + title -->
    <div v-if="!isTile" class="mb-2 flex items-center gap-2">
      <GripVertical v-if="editing" :size="14" class="shrink-0 cursor-grab text-zinc-600" aria-hidden="true" />
      <Icon :name="plugin.config.icon" :size="16" class="text-zinc-400" />
      <h3 class="min-w-0 flex-1 truncate text-sm font-medium text-zinc-300">{{ plugin.config.title || def.name }}</h3>
    </div>

    <!-- Controls (hover, or always in edit mode) -->
    <div
      class="absolute top-1.5 z-10 flex gap-0.5 rounded-lg bg-zinc-900/90 p-0.5 opacity-0 shadow transition group-hover:opacity-100 group-focus-within:opacity-100"
      :class="[isTile ? 'left-1.5' : 'right-1.5', editing ? '!opacity-100' : '']"
    >
      <button class="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100" :aria-label="`Settings for ${plugin.config.title}`" title="Settings" @click.stop="emit('settings')">
        <Settings :size="13" />
      </button>
      <button v-if="editing" class="rounded p-1 text-zinc-400 hover:bg-red-500/20 hover:text-red-300" :aria-label="`Remove ${plugin.config.title}`" title="Remove" @click.stop="emit('remove')">
        <Trash2 :size="13" />
      </button>
    </div>

    <div :class="isTile ? 'h-full' : 'min-h-0 flex-1'">
      <component :is="def.component" :config="plugin.config" :instance-id="plugin.id" @configure="emit('settings')" />
    </div>
  </div>
</template>
