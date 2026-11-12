<script setup>
import { reactive, ref, onMounted, onBeforeUnmount, computed } from 'vue';
import { X } from 'lucide-vue-next';
import { plugins as registry } from '../plugins/index.js';
import { iconNames } from '../icons.js';
import Icon from './Icon.vue';
import HaButtonsEditor from './HaButtonsEditor.vue';
import CalendarsEditor from './CalendarsEditor.vue';
import HotkeyInput from './HotkeyInput.vue';
import JellyfinUserPicker from './JellyfinUserPicker.vue';

const props = defineProps({ plugin: { type: Object, required: true } });
const emit = defineEmits(['close']);

const def = computed(() => registry[props.plugin.type]);
const draft = reactive(JSON.parse(JSON.stringify(props.plugin.config)));
const options = reactive({}); // key -> [{ value, label }] for async selects
const optionError = reactive({});

onMounted(() => {
  document.addEventListener('keydown', onKey);
  for (const f of def.value.settings) {
    if (f.type !== 'select') continue;
    if (f.options) options[f.key] = f.options;
    else if (f.loadOptions) {
      f.loadOptions()
        .then((o) => (options[f.key] = o))
        .catch((e) => (optionError[f.key] = e.message));
    }
  }
});
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
const onKey = (e) => e.key === 'Escape' && emit('close');

function save() {
  for (const f of def.value.settings) {
    if (f.type === 'number') {
      let n = Number(draft[f.key]);
      if (!Number.isFinite(n)) n = f.default ?? f.min ?? 0;
      if (f.integer) n = Math.round(n);
      if (f.min != null) n = Math.max(f.min, n);
      if (f.max != null) n = Math.min(f.max, n);
      draft[f.key] = n;
    } else if (f.type === 'select' && f.numeric) {
      draft[f.key] = Number(draft[f.key]) || 0;
    }
  }
  draft.title = (draft.title || '').trim() || def.value.name;
  Object.assign(props.plugin.config, JSON.parse(JSON.stringify(draft)));
  emit('close');
}

const field = 'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500';
const first = ref(null);
onMounted(() => first.value?.focus());
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:items-center" @mousedown.self="emit('close')">
      <form
        class="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        role="dialog"
        aria-modal="true"
        :aria-label="`${def.name} settings`"
        @submit.prevent="save"
      >
        <header class="flex items-center gap-3 border-b border-zinc-800 px-5 py-4">
          <Icon :name="draft.icon" :size="20" class="text-sky-300" />
          <div class="min-w-0 flex-1">
            <h2 class="text-base font-semibold text-zinc-100">{{ def.name }} settings</h2>
            <p class="text-xs text-zinc-500">These settings belong to this instance only.</p>
          </div>
          <button type="button" class="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Close" @click="emit('close')"><X :size="18" /></button>
        </header>

        <div class="max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4">
          <label class="block text-sm text-zinc-300">Title<input ref="first" v-model="draft.title" maxlength="60" :class="field" /></label>
          <label class="block text-sm text-zinc-300">
            Icon
            <input v-model="draft.icon" list="icon-names" placeholder="name, emoji, or image URL" :class="field" />
            <span class="mt-1 block text-xs text-zinc-500">Pick a name (rocket, mail, code…), paste an emoji like 🚀, or an https image URL.</span>
          </label>
          <datalist id="icon-names"><option v-for="n in iconNames" :key="n" :value="n" /></datalist>

          <template v-for="f in def.settings" :key="f.key">
            <label v-if="f.type === 'checkbox'" class="flex items-center gap-2 text-sm text-zinc-300">
              <input v-model="draft[f.key]" type="checkbox" class="size-4 accent-sky-500" /> {{ f.label }}
            </label>

            <div v-else-if="f.type === 'ha-buttons'">
              <div class="mb-2 text-sm text-zinc-300">{{ f.label }}</div>
              <HaButtonsEditor :buttons="draft.buttons" :conn="{ url: draft.url, token: draft.token }" />
            </div>

            <div v-else-if="f.type === 'hotkey'">
              <div class="mb-1 text-sm text-zinc-300">{{ f.label }}</div>
              <HotkeyInput v-model="draft[f.key]" />
              <p v-if="f.hint" class="mt-1 block text-xs text-zinc-500">{{ f.hint }}</p>
            </div>

            <div v-else-if="f.type === 'jellyfin-user'">
              <div class="mb-2 text-sm text-zinc-300">{{ f.label }}</div>
              <JellyfinUserPicker :draft="draft" />
            </div>

            <div v-else-if="f.type === 'calendars'">
              <div class="mb-2 text-sm text-zinc-300">{{ f.label }}</div>
              <CalendarsEditor :calendars="draft.calendars" />
              <p v-if="f.hint" class="mt-1 block text-xs text-zinc-500">{{ f.hint }}</p>
            </div>

            <label v-else-if="f.type === 'select'" class="block text-sm text-zinc-300">
              {{ f.label }}
              <select v-model="draft[f.key]" :class="field">
                <option v-if="!options[f.key]" :value="draft[f.key]">{{ optionError[f.key] || 'Loading…' }}</option>
                <option v-for="o in options[f.key] || []" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </label>

            <label v-else class="block text-sm text-zinc-300">
              {{ f.label }}
              <input
                v-model="draft[f.key]"
                :type="f.type === 'number' ? 'number' : f.type === 'password' ? 'password' : 'text'"
                :min="f.min"
                :max="f.max"
                :placeholder="f.placeholder"
                :autocomplete="f.type === 'password' ? 'off' : undefined"
                :class="field"
              />
              <span v-if="f.hint" class="mt-1 block text-xs text-zinc-500">{{ f.hint }}</span>
            </label>
          </template>
        </div>

        <footer class="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button type="button" class="rounded-lg px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800" @click="emit('close')">Cancel</button>
          <button type="submit" class="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-sky-400">Save</button>
        </footer>
      </form>
    </div>
  </Teleport>
</template>
