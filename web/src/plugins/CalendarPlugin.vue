<script setup>
import { ref, computed, watch, toRef, onMounted, onBeforeUnmount } from 'vue';
import { api } from '../api.js';
import { usePolling } from '../composables/usePolling.js';
import ErrorLine from '../components/ErrorLine.vue';

const props = defineProps({ config: { type: Object, required: true }, instanceId: { type: String, default: '' } });
const emit = defineEmits(['configure']);

const feeds = computed(() => (props.config.calendars || []).filter((c) => c.id));
const days = computed(() => Math.min(14, Math.max(1, Number(props.config.daysToShow) || 1)));

// "now" drives past-event dimming and the midnight rollover.
const now = ref(new Date());
let tick;
onMounted(() => (tick = setInterval(() => (now.value = new Date()), 30_000)));
onBeforeUnmount(() => clearInterval(tick));

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const { data, error, refresh } = usePolling(async () => {
  if (!feeds.value.length) return { connected: true, events: [], errors: [] };
  return api.post('/plugins/calendar/events', {
    days: days.value,
    calendars: feeds.value.map(({ id, name }) => ({ id, name })),
  });
}, toRef(() => props.config.refreshSeconds));

// Re-fetch right away when feeds/range change (and when the date rolls over).
watch(
  [() => JSON.stringify(feeds.value.map((c) => [c.id, c.name])), days, () => dayKey(now.value)],
  () => refresh()
);

const colorOf = computed(() => Object.fromEntries((props.config.calendars || []).map((c) => [String(c.id), c.color || '#38bdf8'])));

/** One section per day in range, each with its events (all-day first, then by start time). */
const sections = computed(() => {
  const events = data.value?.events ?? [];
  const out = [];
  for (let i = 0; i < days.value; i++) {
    const start = new Date(now.value.getFullYear(), now.value.getMonth(), now.value.getDate() + i);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    const key = dayKey(start);

    const items = [];
    for (const e of events) {
      const s = new Date(e.start);
      const f = new Date(e.end);
      let overlaps;
      if (e.allDay) overlaps = e.startDay <= key && key < e.endDay;
      else overlaps = f > s ? s < end && f > start : s >= start && s < end;
      if (!overlaps) continue;

      let time = 'All day';
      if (!e.allDay) {
        const from = s < start ? '…' : hhmm(s);
        const to = f > end ? '…' : f > s ? hhmm(f) : '';
        time = to ? `${from}-${to}` : from;
      }
      items.push({
        key: `${e.calendarId}|${e.start}|${e.title}`,
        time,
        title: e.title,
        location: e.location,
        color: colorOf.value[e.calendarId] || '#38bdf8',
        allDay: e.allDay,
        sort: e.allDay ? 0 : Math.max(s.getTime(), start.getTime()),
        done: !e.allDay && i === 0 && f > s && f <= now.value,
      });
    }
    items.sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));

    const label =
      i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : start.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    out.push({ key, label, items });
  }
  return out;
});

const errorText = computed(() => {
  const errs = data.value?.errors ?? [];
  return error.value || errs.map((e) => `${e.name}: ${e.message}`).join(' · ');
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2">
    <div v-if="data && data.connected === false" class="flex flex-1 flex-col items-center justify-center gap-2 py-4 text-center text-sm text-zinc-500">
      <span>Connect your Google account to see events</span>
      <button class="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-sky-300 hover:bg-zinc-700" @click="emit('configure')">Open settings</button>
    </div>
    <p v-else-if="!feeds.length" class="py-4 text-center text-sm text-zinc-500">
      Choose calendars in this plugin’s <button class="text-sky-300 hover:underline" @click="emit('configure')">settings</button>.
    </p>

    <div v-else class="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
      <section v-for="(s, idx) in sections" :key="s.key">
        <h3 v-if="days > 1" class="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">{{ s.label }}</h3>
        <ul v-if="s.items.length" class="space-y-1">
          <li v-for="e in s.items" :key="e.key" class="flex items-baseline gap-2 text-sm leading-snug" :class="e.done ? 'opacity-45' : ''">
            <span class="shrink-0 tabular-nums text-xs text-zinc-400 min-w-18">{{ e.time }}</span>
            <i class="inline-block size-2 shrink-0 rounded-full" :style="{ background: e.color }" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-zinc-100" :title="e.location ? `${e.title} — ${e.location}` : e.title">{{ e.title }}</span>
          </li>
        </ul>
        <p v-else-if="days === 1 || idx === 0" class="text-sm text-zinc-600">{{ data ? 'No events' : 'Loading…' }}</p>
        <p v-else class="text-xs text-zinc-700">No events</p>
      </section>
    </div>

    <ErrorLine :message="errorText" />
  </div>
</template>
