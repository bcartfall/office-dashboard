<script setup>
import { reactive, computed, toRef } from 'vue';
import { api } from '../api.js';
import { usePolling } from '../composables/usePolling.js';
import Icon from '../components/Icon.vue';
import ErrorLine from '../components/ErrorLine.vue';

const props = defineProps({ config: { type: Object, required: true } });
const emit = defineEmits(['configure']);

const busy = reactive({}); // buttonId -> 'busy' | 'ok' | 'error'
const lastError = reactive({ msg: '' });

const conn = () => ({ url: props.config.url, token: props.config.token });
const entityIds = computed(() => [...new Set((props.config.buttons || []).map((b) => b.entity_id).filter(Boolean))]);

// Poll entity states so buttons can show on/off.
const { data: states, error, refresh } = usePolling(
  async () => {
    if (!entityIds.value.length) return {};
    const list = await api.post('/plugins/home-assistant/states', { ...conn(), entityIds: entityIds.value });
    return Object.fromEntries(list.map((s) => [s.entity_id, s.state]));
  },
  toRef(() => props.config.refreshSeconds)
);

const isOn = (b) => ['on', 'open', 'unlocked', 'playing', 'home'].includes(states.value?.[b.entity_id]);

async function press(b) {
  busy[b.id] = 'busy';
  lastError.msg = '';
  try {
    await api.post('/plugins/home-assistant/call', {
      ...conn(),
      action: b.action,
      entity_id: b.entity_id || undefined,
      data: b.data || undefined,
    });
    busy[b.id] = 'ok';
    setTimeout(refresh, 700);
  } catch (e) {
    busy[b.id] = 'error';
    lastError.msg = e.message;
  }
  setTimeout(() => delete busy[b.id], 1600);
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2">
    <div v-if="!config.buttons?.length" class="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-zinc-500">
      <span>No actions yet</span>
      <button class="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-sky-300 hover:bg-zinc-700" @click="emit('configure')">Add buttons</button>
    </div>
    <div v-else class="grid flex-1 content-start gap-2" style="grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); grid-auto-rows: minmax(64px, 1fr)">
      <button
        v-for="b in config.buttons"
        :key="b.id"
        type="button"
        class="relative flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
        :class="
          busy[b.id] === 'error'
            ? 'border-red-500/60 bg-red-500/10'
            : busy[b.id] === 'ok'
              ? 'border-emerald-500/60 bg-emerald-500/10'
              : isOn(b)
                ? 'border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/15'
                : 'border-zinc-800 bg-zinc-800/40 hover:border-sky-500/50 hover:bg-zinc-800'
        "
        :disabled="busy[b.id] === 'busy'"
        :title="`${b.action}${b.entity_id ? ' → ' + b.entity_id : ''}`"
        @click="press(b)"
      >
        <span v-if="states && b.entity_id && states[b.entity_id] !== undefined" class="absolute right-1.5 top-1.5 size-1.5 rounded-full" :class="isOn(b) ? 'bg-amber-400' : 'bg-zinc-600'" />
        <Icon :name="b.icon" :size="22" :class="isOn(b) ? 'text-amber-300' : 'text-sky-300'" />
        <span class="max-w-full truncate text-xs font-medium text-zinc-200">{{ b.label }}</span>
      </button>
    </div>
    <ErrorLine :message="lastError.msg || (config.buttons?.length ? error : '')" />
  </div>
</template>
