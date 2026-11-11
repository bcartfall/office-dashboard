<script setup>
import { ref } from 'vue';
import { Plus, Trash2, RefreshCw } from 'lucide-vue-next';
import { api } from '../api.js';
import { uid } from '../store/layout.js';
import { iconNames } from '../icons.js';

/** Edits the list of Home Assistant action buttons. `conn` = { url, token } from the settings draft. */
const props = defineProps({ buttons: { type: Array, required: true }, conn: { type: Object, required: true } });

const entities = ref([]);
const loading = ref(false);
const loadError = ref('');

const ACTIONS = [
  'homeassistant.toggle', 'homeassistant.turn_on', 'homeassistant.turn_off',
  'scene.turn_on', 'script.turn_on', 'automation.trigger', 'button.press',
  'light.toggle', 'switch.toggle', 'cover.open_cover', 'cover.close_cover', 'lock.lock', 'lock.unlock',
  'media_player.media_play_pause', 'input_boolean.toggle', 'notify.notify',
];
const DOMAIN_DEFAULT = {
  scene: ['scene.turn_on', 'palette'], script: ['script.turn_on', 'workflow'], automation: ['automation.trigger', 'workflow'],
  button: ['button.press', 'power'], light: ['homeassistant.toggle', 'light'], switch: ['homeassistant.toggle', 'plug'],
  cover: ['homeassistant.toggle', 'blinds'], lock: ['homeassistant.toggle', 'lock'], fan: ['homeassistant.toggle', 'fan'],
  media_player: ['media_player.media_play_pause', 'speaker'], input_boolean: ['input_boolean.toggle', 'zap'],
};

async function loadEntities() {
  loading.value = true;
  loadError.value = '';
  try {
    const list = await api.post('/plugins/home-assistant/states', { ...props.conn });
    entities.value = list
      .filter((e) => /^(light|switch|scene|script|automation|button|cover|lock|fan|media_player|input_boolean)\./.test(e.entity_id))
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  } catch (e) {
    loadError.value = e.message;
  } finally {
    loading.value = false;
  }
}

function add() {
  props.buttons.push({ id: uid(), label: 'Button', icon: 'zap', entity_id: '', action: 'homeassistant.toggle', data: '' });
}

/** Autofill label, action and icon when an entity is picked from the loaded list. */
function onEntity(b) {
  const hit = entities.value.find((e) => e.entity_id === b.entity_id);
  if (!hit) return;
  const [action, icon] = DOMAIN_DEFAULT[hit.entity_id.split('.')[0]] ?? ['homeassistant.toggle', 'zap'];
  b.action = action;
  if (!b.label || b.label === 'Button') b.label = hit.name;
  if (b.icon === 'zap') b.icon = icon;
}

const input = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-500';
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2">
      <button type="button" class="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700" @click="loadEntities">
        <RefreshCw :size="13" :class="loading ? 'animate-spin' : ''" /> Load entities from Home Assistant
      </button>
      <span v-if="entities.length" class="text-xs text-emerald-400">{{ entities.length }} loaded — pick from the Entity lists</span>
    </div>
    <p v-if="loadError" class="rounded bg-red-500/10 px-2 py-1 text-xs text-red-300">{{ loadError }}</p>

    <datalist id="ha-entities"><option v-for="e in entities" :key="e.entity_id" :value="e.entity_id">{{ e.name }}</option></datalist>
    <datalist id="ha-actions"><option v-for="a in ACTIONS" :key="a" :value="a" /></datalist>
    <datalist id="ha-icons"><option v-for="n in iconNames" :key="n" :value="n" /></datalist>

    <div v-for="(b, i) in buttons" :key="b.id" class="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
      <div class="grid grid-cols-2 gap-2">
        <label class="text-xs text-zinc-500">Label<input v-model="b.label" :class="input" /></label>
        <label class="text-xs text-zinc-500">Icon<input v-model="b.icon" list="ha-icons" :class="input" /></label>
        <label class="text-xs text-zinc-500">Entity<input v-model="b.entity_id" list="ha-entities" placeholder="light.desk" :class="input" @change="onEntity(b)" /></label>
        <label class="text-xs text-zinc-500">Action (domain.service)<input v-model="b.action" list="ha-actions" :class="input" /></label>
        <label class="col-span-2 text-xs text-zinc-500">Extra service data (JSON, optional)<input v-model="b.data" placeholder='{"brightness_pct": 40}' :class="[input, 'font-mono']" /></label>
      </div>
      <div class="mt-2 flex justify-between">
        <span class="flex gap-1">
          <button type="button" class="rounded px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 disabled:opacity-30" :disabled="i === 0" @click="buttons.splice(i - 1, 2, buttons[i], buttons[i - 1])">↑</button>
          <button type="button" class="rounded px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 disabled:opacity-30" :disabled="i === buttons.length - 1" @click="buttons.splice(i, 2, buttons[i + 1], buttons[i])">↓</button>
        </span>
        <button type="button" class="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/15" @click="buttons.splice(i, 1)"><Trash2 :size="12" /> Remove</button>
      </div>
    </div>

    <button type="button" class="flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-sm text-sky-300 hover:bg-zinc-800" @click="add"><Plus :size="14" /> Add button</button>
  </div>
</template>
