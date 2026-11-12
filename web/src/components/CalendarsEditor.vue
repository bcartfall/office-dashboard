<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue';
import { RefreshCw, LogOut, ExternalLink, Check } from 'lucide-vue-next';
import { api } from '../api.js';

/**
 * Google Calendar setup for a calendar plugin.
 *  - connection (OAuth client id/secret + "Connect") is shared by every calendar plugin and kept on the server
 *  - the tick-list below is this plugin's own selection: `calendars` = [{ id, name, color }]
 */
const props = defineProps({ calendars: { type: Array, required: true } });

const PALETTE = ['#38bdf8', '#fb923c', '#34d399', '#f472b6', '#a78bfa', '#fbbf24', '#f87171', '#2dd4bf'];

const status = ref(null);
const account = ref([]); // every calendar on the Google account
const loading = ref(false);
const waiting = ref(false); // waiting for the Google sign-in tab to finish
const error = ref('');
const showClient = ref(false);
const form = reactive({ clientId: '', clientSecret: '' });
let poll;

async function refreshStatus() {
  status.value = await api.get('/plugins/calendar/status');
  return status.value;
}

async function loadCalendars() {
  loading.value = true;
  error.value = '';
  try {
    account.value = await api.get('/plugins/calendar/calendars');
    // keep names of already-selected calendars in sync with Google
    for (const sel of props.calendars) {
      const g = account.value.find((c) => c.id === sel.id);
      if (g && !sel.name) sel.name = g.name;
    }
  } catch (e) {
    error.value = e.message;
    refreshStatus().catch(() => {});
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    if ((await refreshStatus()).connected) loadCalendars();
    else showClient.value = !status.value.configured;
  } catch (e) {
    error.value = e.message;
  }
});
onBeforeUnmount(() => clearInterval(poll));

async function saveClient() {
  error.value = '';
  try {
    status.value = await api.post('/plugins/calendar/client', { clientId: form.clientId, clientSecret: form.clientSecret });
    form.clientSecret = '';
    showClient.value = false;
  } catch (e) {
    error.value = e.message;
  }
}

async function connect() {
  error.value = '';
  try {
    const { url } = await api.post('/plugins/calendar/auth/start');
    window.open(url, '_blank', 'noopener');
    waiting.value = true;
    clearInterval(poll);
    const until = Date.now() + 10 * 60_000;
    poll = setInterval(async () => {
      try {
        if ((await refreshStatus()).connected) {
          clearInterval(poll);
          waiting.value = false;
          loadCalendars();
        }
      } catch {
        /* keep trying */
      }
      if (Date.now() > until) {
        clearInterval(poll);
        waiting.value = false;
      }
    }, 2000);
  } catch (e) {
    error.value = e.message;
  }
}

async function disconnect() {
  error.value = '';
  try {
    status.value = await api.post('/plugins/calendar/disconnect');
    account.value = [];
  } catch (e) {
    error.value = e.message;
  }
}

const selected = (id) => props.calendars.find((c) => c.id === id);

function toggle(c) {
  const at = props.calendars.findIndex((x) => x.id === c.id);
  if (at >= 0) props.calendars.splice(at, 1);
  else {
    const used = new Set(props.calendars.map((x) => x.color));
    props.calendars.push({ id: c.id, name: c.name, color: c.color || PALETTE.find((p) => !used.has(p)) || PALETTE[0] });
  }
}

/** Account calendars first, then anything selected earlier that Google no longer lists. */
const rows = computed(() => {
  const known = new Set(account.value.map((c) => c.id));
  const orphans = props.calendars.filter((c) => !known.has(c.id)).map((c) => ({ id: c.id, name: c.name || c.id, color: c.color, orphan: true }));
  return [...account.value, ...orphans];
});

const input = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500';
</script>

<template>
  <div class="space-y-3">
    <!-- connection -->
    <div class="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3 text-sm">
      <div v-if="!status" class="text-zinc-500">Checking Google connection…</div>

      <template v-else>
        <div class="flex flex-wrap items-center gap-2">
          <span v-if="status.connected" class="flex items-center gap-1.5 text-emerald-400"><Check :size="14" /> Connected to Google<span v-if="status.account" class="text-zinc-500"> · {{ status.account }}</span></span>
          <span v-else-if="status.configured" class="text-zinc-400">Not connected to Google yet.</span>
          <span v-else class="text-zinc-400">Enter your Google OAuth client to connect.</span>

          <span class="ml-auto flex gap-1.5">
            <button v-if="status.configured && !status.connected" type="button" class="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-sky-400 disabled:opacity-60" :disabled="waiting" @click="connect">
              <ExternalLink :size="13" /> {{ waiting ? 'Waiting for Google…' : 'Connect Google Calendar' }}
            </button>
            <button v-if="status.connected" type="button" class="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700" @click="disconnect"><LogOut :size="13" /> Disconnect</button>
            <button v-if="!status.clientFromEnv && !showClient" type="button" class="rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800" @click="showClient = true">OAuth client…</button>
          </span>
        </div>

        <div v-if="showClient && !status.clientFromEnv" class="mt-3 space-y-2 border-t border-zinc-800 pt-3">
          <p class="text-xs leading-relaxed text-zinc-500">
            In <b class="font-medium text-zinc-300">Google Cloud Console</b>: create a project, enable the <b class="font-medium text-zinc-300">Google Calendar API</b>, configure the OAuth consent screen
            (add yourself as a test user), then create an <b class="font-medium text-zinc-300">OAuth client ID</b> of type <b class="font-medium text-zinc-300">Desktop app</b> and paste its values here.
            They are stored on the server only (<code>data/google.json</code>); access is read-only.
          </p>
          <input v-model="form.clientId" placeholder="Client ID  (….apps.googleusercontent.com)" autocomplete="off" spellcheck="false" :class="[input, 'font-mono']" />
          <input v-model="form.clientSecret" type="password" :placeholder="status.configured ? 'Client secret (re-enter to change the client)' : 'Client secret'" autocomplete="off" :class="[input, 'font-mono']" />
          <div class="flex gap-2">
            <button type="button" class="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-sky-400 disabled:opacity-50" :disabled="!form.clientId.trim() || !form.clientSecret.trim()" @click="saveClient">Save client</button>
            <button v-if="status.configured" type="button" class="rounded-lg px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800" @click="showClient = false">Cancel</button>
          </div>
        </div>
      </template>
    </div>

    <!-- calendar picker -->
    <div v-if="status?.connected">
      <div class="mb-1.5 flex items-center gap-2">
        <span class="text-xs text-zinc-500">Tick the calendars to show — including ones shared with you.</span>
        <button type="button" class="ml-auto flex items-center gap-1.5 rounded-lg bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50" :disabled="loading" @click="loadCalendars">
          <RefreshCw :size="12" :class="loading ? 'animate-spin' : ''" /> Reload
        </button>
      </div>

      <ul v-if="rows.length" class="divide-y divide-zinc-800/80 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/50">
        <li v-for="c in rows" :key="c.id" class="flex items-center gap-2.5 px-3 py-2">
          <input type="checkbox" class="size-4 shrink-0 accent-sky-500" :checked="Boolean(selected(c.id))" :aria-label="`Show ${c.name}`" @change="toggle(c)" />
          <template v-if="selected(c.id)">
            <input v-model="selected(c.id).color" type="color" class="h-6 w-8 shrink-0 cursor-pointer rounded border border-zinc-700 bg-zinc-950 p-0.5" :aria-label="`Color for ${c.name}`" />
            <input v-model="selected(c.id).name" :placeholder="c.name" maxlength="60" class="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-sm text-zinc-100 outline-none hover:border-zinc-700 focus:border-sky-500" :aria-label="`Display name for ${c.name}`" />
          </template>
          <template v-else>
            <i class="inline-block size-3 shrink-0 rounded-full opacity-60" :style="{ background: c.color }" />
            <span class="min-w-0 flex-1 truncate text-sm text-zinc-400">{{ c.name }}</span>
          </template>
          <span v-if="c.primary" class="shrink-0 text-[10px] uppercase tracking-wide text-zinc-600">primary</span>
          <span v-else-if="c.orphan" class="shrink-0 text-[10px] uppercase tracking-wide text-amber-400/80">not found</span>
        </li>
      </ul>
      <p v-else-if="!loading" class="text-sm text-zinc-600">No calendars found on this account.</p>
    </div>

    <p v-if="error" class="rounded bg-red-500/10 px-2 py-1 text-xs text-red-300">{{ error }}</p>
  </div>
</template>
