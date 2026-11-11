<script setup>
import { Plus, Trash2 } from 'lucide-vue-next';
import { uid } from '../store/layout.js';

/** Edits the list of ICS feeds for a calendar plugin: name, ICS URL and a colour for each. */
const props = defineProps({ calendars: { type: Array, required: true } });

const PALETTE = ['#38bdf8', '#fb923c', '#34d399', '#f472b6', '#a78bfa', '#fbbf24', '#f87171', '#2dd4bf'];

function add() {
  const used = new Set(props.calendars.map((c) => c.color));
  const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[props.calendars.length % PALETTE.length];
  props.calendars.push({ id: uid(), name: '', url: '', color });
}

const input = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500';
</script>

<template>
  <div class="space-y-3">
    <div v-for="(c, i) in calendars" :key="c.id" class="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
      <div class="flex items-end gap-2">
        <label class="text-xs text-zinc-500">
          Color
          <input v-model="c.color" type="color" class="mt-1 block h-[34px] w-11 cursor-pointer rounded-md border border-zinc-700 bg-zinc-950 p-0.5" :aria-label="`Color for calendar ${i + 1}`" />
        </label>
        <label class="min-w-0 flex-1 text-xs text-zinc-500">
          Name (optional)
          <input v-model="c.name" maxlength="60" placeholder="Work, Family…" :class="input" />
        </label>
      </div>
      <label class="mt-2 block text-xs text-zinc-500">
        ICS URL
        <input v-model="c.url" placeholder="https://…/calendar.ics  or  webcal://…" autocomplete="off" spellcheck="false" :class="[input, 'font-mono']" />
      </label>
      <div class="mt-2 flex justify-between">
        <span class="flex gap-1">
          <button type="button" class="rounded px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 disabled:opacity-30" :disabled="i === 0" @click="calendars.splice(i - 1, 2, calendars[i], calendars[i - 1])">↑</button>
          <button type="button" class="rounded px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 disabled:opacity-30" :disabled="i === calendars.length - 1" @click="calendars.splice(i, 2, calendars[i + 1], calendars[i])">↓</button>
        </span>
        <button type="button" class="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/15" @click="calendars.splice(i, 1)"><Trash2 :size="12" /> Remove</button>
      </div>
    </div>

    <button type="button" class="flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-sm text-sky-300 hover:bg-zinc-800" @click="add"><Plus :size="14" /> Add calendar</button>
  </div>
</template>
