<script setup>
import { ref } from 'vue';
import { RefreshCw } from 'lucide-vue-next';
import { api } from '../api.js';

/** Picks the Jellyfin user whose "Up Next" list is shown. `draft` is the settings draft (url, apiKey, userId). */
const props = defineProps({ draft: { type: Object, required: true } });

const users = ref([]);
const loading = ref(false);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    users.value = await api.post('/plugins/jellyfin/users', { url: props.draft.url, apiKey: props.draft.apiKey });
    if (!users.value.some((u) => u.id === props.draft.userId)) props.draft.userId = users.value[0]?.id ?? '';
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

const field = 'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500';
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center gap-2">
      <button type="button" class="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50" :disabled="loading || !draft.url || !draft.apiKey" @click="load">
        <RefreshCw :size="13" :class="loading ? 'animate-spin' : ''" /> Load users from Jellyfin
      </button>
      <span v-if="users.length" class="text-xs text-emerald-400">{{ users.length }} found</span>
    </div>
    <select v-if="users.length" v-model="draft.userId" :class="field">
      <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</option>
    </select>
    <p v-else-if="draft.userId" class="text-xs text-zinc-500">User selected. Load the list to change it.</p>
    <p v-if="error" class="rounded bg-red-500/10 px-2 py-1 text-xs text-red-300">{{ error }}</p>
  </div>
</template>
