<script setup>
import { reactive, computed, toRef, watch } from 'vue';
import { Play, LoaderCircle } from 'lucide-vue-next';
import { api } from '../api.js';
import { usePolling } from '../composables/usePolling.js';
import ErrorLine from '../components/ErrorLine.vue';

const props = defineProps({ config: { type: Object, required: true }, instanceId: { type: String, default: '' } });
const emit = defineEmits(['configure']);

const configured = computed(() => Boolean(props.config.url?.trim() && props.config.apiKey?.trim() && props.config.userId));
const conn = () => ({ url: props.config.url, apiKey: props.config.apiKey });

const { data, error, refresh } = usePolling(async () => {
  if (!configured.value) return null;
  return api.post('/plugins/jellyfin/nextup', { ...conn(), userId: props.config.userId, limit: props.config.maxItems });
}, toRef(() => props.config.refreshSeconds));

// Show the new connection / user / count right after settings are saved instead of at the next poll.
watch(() => [props.config.url, props.config.apiKey, props.config.userId, props.config.maxItems].join('|'), () => refresh());

const items = computed(() => data.value?.items ?? []);
const imageSrc = (img) =>
  img && data.value?.conn
    ? `/api/plugins/jellyfin/image?${new URLSearchParams({ c: data.value.conn, id: img.id, type: img.type, tag: img.tag, w: '480' })}`
    : '';

// itemId -> 'busy' | 'ok' ; message holds the last failure
const state = reactive({});
const lastError = reactive({ msg: '' });

async function play(item) {
  if (state[item.id] === 'busy') return;
  state[item.id] = 'busy';
  lastError.msg = '';
  try {
    await api.post('/plugins/jellyfin/play', {
      ...conn(),
      userId: props.config.userId,
      itemId: item.id,
      resumeTicks: item.resumeTicks,
      client: props.config.desktopClient,
      command: props.config.desktopCommand,
      args: props.config.desktopArgs,
    });
    state[item.id] = 'ok';
  } catch (e) {
    state[item.id] = null;
    lastError.msg = e.message;
  }
  setTimeout(() => state[item.id] === 'ok' && delete state[item.id], 2000);
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2">
    <div v-if="!configured" class="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-zinc-500">
      <span>Connect to your Jellyfin server</span>
      <button class="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-sky-300 hover:bg-zinc-700" @click="emit('configure')">Open settings</button>
    </div>

    <p v-else-if="data && !items.length" class="py-4 text-center text-sm text-zinc-600">Nothing up next</p>

    <ul v-else class="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto pr-1" style="grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))">
      <li v-for="it in items" :key="it.id" class="min-w-0">
        <button
          type="button"
          class="group/ep block w-full rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
          :title="`Play ${it.series} ${it.code} in the Jellyfin app`"
          @click="play(it)"
        >
          <span class="relative block aspect-video w-full overflow-hidden rounded-lg bg-zinc-800">
            <img v-if="imageSrc(it.image)" :src="imageSrc(it.image)" :alt="`${it.series} ${it.code}`" loading="lazy" draggable="false" class="size-full object-cover" />
            <span class="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition group-hover/ep:opacity-100 group-focus-visible/ep:opacity-100" :class="state[it.id] ? '!opacity-100' : ''">
              <LoaderCircle v-if="state[it.id] === 'busy'" :size="28" class="animate-spin text-white" />
              <Play v-else :size="28" class="fill-white text-white" />
            </span>
            <span v-if="it.progress > 0" class="absolute inset-x-0 bottom-0 h-1 bg-black/50"><span class="block h-full bg-sky-400" :style="{ width: Math.min(100, it.progress) + '%' }" /></span>
          </span>
          <span class="mt-1.5 block truncate text-sm font-medium leading-tight text-zinc-100" :title="it.series">{{ it.series }}</span>
          <span class="block truncate text-xs leading-tight text-zinc-400" :title="`${it.code} ${it.title}`">
            <span class="tabular-nums text-sky-300">{{ it.code }}</span><span v-if="it.code && it.title"> · </span>{{ it.title }}
          </span>
        </button>
      </li>
    </ul>

    <ErrorLine :message="lastError.msg || error" />
  </div>
</template>
