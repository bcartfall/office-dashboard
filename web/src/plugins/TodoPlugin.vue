<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import {
  Check, GripVertical, MoreHorizontal, ArrowUpToLine, ArrowDownToLine, CircleCheck, CircleDashed, Trash2, Pencil, History, X, ChevronLeft, ChevronRight,
} from 'lucide-vue-next';
import { api } from '../api.js';

// Tasks live in this instance's config (config.items), so they are saved with the layout like every other setting.
const props = defineProps({ config: { type: Object, required: true }, instanceId: { type: String, default: '' } });

const items = computed(() => {
  if (!Array.isArray(props.config.items)) props.config.items = [];
  return props.config.items;
});

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const indexOf = (id) => items.value.findIndex((t) => t.id === id);

// ---- add -------------------------------------------------------------------
const draft = ref('');
const list = ref(null);

async function add() {
  const text = draft.value.trim();
  if (!text) return;
  items.value.push({ id: uid(), text, done: false, created: Date.now() });
  draft.value = '';
  await nextTick();
  if (list.value) list.value.scrollTop = list.value.scrollHeight;
}
const onInputKey = (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    add();
  }
};

// ---- task actions ----------------------------------------------------------
function moveTo(id, to) {
  const from = indexOf(id);
  if (from < 0) return;
  const [item] = items.value.splice(from, 1);
  items.value.splice(Math.max(0, Math.min(to, items.value.length)), 0, item);
}
const moveToTop = (id) => moveTo(id, 0);
const moveToBottom = (id) => moveTo(id, items.value.length);
/** Check / uncheck a task. Checked tasks disappear after REMOVE_AFTER_MS (see below); the time is kept for the history. */
function setDone(task, done) {
  task.done = done;
  if (done) task.completedAt = Date.now();
  else delete task.completedAt;
}
const toggle = (task) => setDone(task, !task.done);
function toggleDone(id) {
  const t = items.value.find((x) => x.id === id);
  if (t) toggle(t);
}
function remove(id) {
  const i = indexOf(id);
  if (i >= 0) items.value.splice(i, 1);
}

// Clicking anywhere on a task toggles it - except on the "..." button (it opens the menu), after selecting text,
// right after a click that merely dismissed the context menu, and while re-ordering.
function onRowClick(e, task) {
  if (e.button !== 0 || drag.value.id) return;
  if (performance.now() - menuDismissedAt < 500) return;
  if (window.getSelection()?.toString() || editing.value) return;
  toggle(task);
}

// Keyboard: Space / Enter toggles the focused task; Alt + Arrow Up / Down re-orders it.
function onRowKey(e, task) {
  if ((e.key === ' ' || e.key === 'Enter') && !e.altKey && e.target === e.currentTarget) {
    e.preventDefault();
    toggle(task);
    return;
  }
  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  e.preventDefault();
  const i = indexOf(task.id);
  moveTo(task.id, i + (e.key === 'ArrowUp' ? -1 : 1));
  nextTick(() => list.value?.querySelector(`[data-task="${task.id}"]`)?.focus());
}

// ---- drag & drop reordering ------------------------------------------------
const drag = ref({ id: null, at: null }); // `at` = insertion index (0..items.length)

function onDragStart(e, task) {
  e.stopPropagation(); // don't start a plugin drag in the panel while the layout is being edited
  drag.value = { id: task.id, at: null };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', task.text);
}
function onRowDragOver(e, index) {
  if (!drag.value.id) return;
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'move';
  const r = e.currentTarget.getBoundingClientRect();
  drag.value.at = e.clientY > r.top + r.height / 2 ? index + 1 : index;
}
function onListDragOver(e) {
  if (!drag.value.id) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.target === e.currentTarget) drag.value.at = items.value.length; // empty space below the last task
}
function onDrop(e) {
  if (!drag.value.id) return;
  e.preventDefault();
  e.stopPropagation();
  const { id, at } = drag.value;
  endDrag();
  if (at == null) return;
  const from = indexOf(id);
  if (from < 0) return;
  moveTo(id, at > from ? at - 1 : at);
}
function endDrag() {
  drag.value = { id: null, at: null };
}
const showLineBefore = (i) => drag.value.id && drag.value.at === i && indexOf(drag.value.id) !== i && indexOf(drag.value.id) !== i - 1;
const showLineAfterLast = computed(() => {
  const n = items.value.length;
  return drag.value.id && drag.value.at === n && indexOf(drag.value.id) !== n - 1;
});

// ---- checked tasks go away after 5 seconds ----------------------------------
// (Unchecking within that time keeps the task. The history below still has it, with its completion time.)
const REMOVE_AFTER_MS = 5000;
const removeTimers = new Map(); // task id -> timeout
function syncRemoveTimers() {
  const done = new Map(items.value.filter((t) => t.done).map((t) => [t.id, t]));
  for (const [id, timer] of removeTimers) {
    if (!done.has(id)) {
      clearTimeout(timer);
      removeTimers.delete(id);
    }
  }
  for (const [id, t] of done) {
    if (removeTimers.has(id)) continue;
    // a task already checked when the page loads has been counting down since it was checked
    const left = t.completedAt ? Math.min(REMOVE_AFTER_MS, Math.max(0, REMOVE_AFTER_MS - (Date.now() - t.completedAt))) : REMOVE_AFTER_MS;
    removeTimers.set(
      id,
      setTimeout(() => {
        removeTimers.delete(id);
        if (items.value.find((x) => x.id === id)?.done) remove(id);
      }, left)
    );
  }
}
watch(() => items.value.map((t) => `${t.id}:${t.done ? 1 : 0}`).join('|'), syncRemoveTimers, { immediate: true });

// ---- edit label ------------------------------------------------------------
const editing = ref(null); // { id, text }
function startEdit(id) {
  const t = items.value.find((x) => x.id === id);
  if (!t) return;
  editing.value = { id, text: t.text };
  nextTick(() => {
    const input = list.value?.querySelector(`[data-task="${id}"] input`);
    input?.focus();
    input?.select();
  });
}
function commitEdit() {
  const e = editing.value;
  if (!e) return;
  editing.value = null;
  const t = items.value.find((x) => x.id === e.id);
  const text = e.text.trim();
  if (t && text && text !== t.text) t.text = text;
}
const cancelEdit = () => (editing.value = null);

// ---- history (kept on the server in SQLite) -----------------------------------
let syncTimer;
let syncChain = Promise.resolve(); // requests go out one at a time, in order, so the server always ends up with the latest list
function pushHistory() {
  if (!props.instanceId) return Promise.resolve();
  const snapshot = items.value.map((t) => ({ id: t.id, text: t.text, done: !!t.done, created: t.created, completedAt: t.completedAt }));
  syncChain = syncChain.then(() => api.post('/plugins/todo/sync', { instanceId: props.instanceId, items: snapshot })).catch(() => {}); // the next change sends the whole list again
  return syncChain;
}
watch(
  () => JSON.stringify(items.value.map((t) => [t.id, t.text, !!t.done])),
  () => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushHistory, 400);
  }
);
onMounted(pushHistory); // also records tasks that already existed before the history was introduced
onBeforeUnmount(() => {
  clearTimeout(syncTimer);
  for (const timer of removeTimers.values()) clearTimeout(timer);
});

const PAGE_SIZE = 10;
const hist = ref(null); // { rows, total, page, pages } while the modal is open
const histState = ref({ open: false, loading: false, error: '', filter: 'all', page: 1 });
async function loadHistory(page = histState.value.page) {
  const st = histState.value;
  st.loading = true;
  st.error = '';
  try {
    const q = new URLSearchParams({ instanceId: props.instanceId, page: String(page), pageSize: String(PAGE_SIZE), filter: st.filter });
    hist.value = await api.get(`/plugins/todo/history?${q}`);
    st.page = hist.value.page;
  } catch (e) {
    st.error = e.message;
  } finally {
    st.loading = false;
  }
}
async function openHistory() {
  clearTimeout(syncTimer);
  histState.value = { open: true, loading: true, error: '', filter: 'all', page: 1 };
  hist.value = null;
  document.addEventListener('keydown', onHistoryKey, true);
  await pushHistory(); // make sure the server has the latest list before reading it back
  loadHistory(1);
}
function closeHistory() {
  histState.value.open = false;
  document.removeEventListener('keydown', onHistoryKey, true);
}
function onHistoryKey(e) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    closeHistory();
  }
}
onBeforeUnmount(() => document.removeEventListener('keydown', onHistoryKey, true));
const fmtTime = (t) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

// ---- context menu ----------------------------------------------------------
const MENU_W = 200;
const MENU_H = 190;
const BG_MENU_H = 46;
const menu = ref(null); // { id, x, y }
const menuEl = ref(null);
const menuTask = computed(() => (menu.value?.id ? items.value.find((t) => t.id === menu.value.id) : null));
const menuIndex = computed(() => (menu.value ? indexOf(menu.value.id) : -1));

function openMenu(e, task, anchor) {
  e.preventDefault();
  e.stopPropagation();
  const rect = anchor?.getBoundingClientRect();
  const px = rect ? rect.right : e.clientX;
  const py = rect ? rect.bottom : e.clientY;
  showMenu(rect ? px - MENU_W : px, py, task.id, MENU_H);
}
/** Right click on empty space (not on a task or the input): the list-level menu. */
function openBgMenu(e) {
  if (e.target.closest?.('[data-task], input, textarea')) return;
  e.preventDefault();
  e.stopPropagation();
  showMenu(e.clientX, e.clientY, null, BG_MENU_H);
}
function showMenu(px, py, id, height) {
  const x = Math.max(8, Math.min(window.innerWidth - MENU_W - 8, px));
  const y = Math.max(8, Math.min(window.innerHeight - height - 8, py));
  menu.value = { id, x, y };
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onMenuKey, true);
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);
  document.addEventListener('scroll', closeMenu, true);
  nextTick(() => menuEl.value?.querySelector('button:not([disabled])')?.focus());
}
function closeMenu() {
  menu.value = null;
  document.removeEventListener('pointerdown', onOutside, true);
  document.removeEventListener('keydown', onMenuKey, true);
  window.removeEventListener('blur', closeMenu);
  window.removeEventListener('resize', closeMenu);
  document.removeEventListener('scroll', closeMenu, true);
}
let menuDismissedAt = -Infinity;
const onOutside = (e) => {
  if (menuEl.value?.contains(e.target)) return;
  menuDismissedAt = performance.now();
  closeMenu();
};
function onMenuKey(e) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    return closeMenu();
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const btns = [...menuEl.value.querySelectorAll('button:not([disabled])')];
  if (!btns.length) return;
  const i = btns.indexOf(document.activeElement);
  btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length].focus();
}
function act(fn) {
  const id = menu.value?.id;
  closeMenu();
  fn(id);
}
onBeforeUnmount(closeMenu);

const menuItem =
  'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800 focus:bg-zinc-800 focus:outline-none disabled:pointer-events-none disabled:opacity-35';
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" @contextmenu="openBgMenu">
    <!-- Task list -->
    <ul
      ref="list"
      class="-mx-1 min-h-0 flex-1 space-y-px overflow-y-auto px-1"
      role="list"
      @dragover="onListDragOver"
      @drop="onDrop"
    >
      <li
        v-for="(task, i) in items"
        :key="task.id"
        :data-task="task.id"
        tabindex="0"
        :draggable="editing?.id !== task.id"
        role="checkbox"
        :aria-checked="!!task.done"
        :aria-label="task.text"
        class="group/task relative flex cursor-pointer items-start gap-1.5 rounded-lg py-1 pl-0.5 pr-1 outline-none transition hover:bg-zinc-800/60 focus-visible:ring-1 focus-visible:ring-sky-500/70"
        :class="drag.id === task.id ? 'opacity-40' : ''"
        @dragstart="onDragStart($event, task)"
        @dragend="endDrag"
        @dragover="onRowDragOver($event, i)"
        @drop="onDrop"
        @click="onRowClick($event, task)"
        @contextmenu="openMenu($event, task)"
        @keydown="onRowKey($event, task)"
      >
        <span v-if="showLineBefore(i)" class="pointer-events-none absolute inset-x-0 -top-px h-0.5 rounded bg-sky-400" />
        <GripVertical :size="14" class="mt-1 shrink-0 cursor-grab text-zinc-700 transition group-hover/task:text-zinc-500" aria-hidden="true" />

        <span
          class="mt-px grid size-4 shrink-0 place-items-center rounded border transition"
          :class="task.done ? 'border-sky-500 bg-sky-500 text-zinc-950' : 'border-zinc-600 bg-zinc-950 group-hover/task:border-sky-400'"
          aria-hidden="true"
        >
          <Check v-if="task.done" :size="12" stroke-width="3.5" />
        </span>

        <input
          v-if="editing?.id === task.id"
          v-model="editing.text"
          type="text"
          maxlength="500"
          aria-label="Edit task"
          class="min-w-0 flex-1 rounded border border-sky-500 bg-zinc-950 px-1.5 text-sm leading-5 text-zinc-100 outline-none"
          @keydown.enter.prevent="commitEdit"
          @keydown.esc.prevent.stop="cancelEdit"
          @blur="commitEdit"
          @click.stop
          @mousedown.stop
        />
        <span v-else class="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-5" :class="task.done ? 'text-zinc-500 line-through decoration-zinc-600' : 'text-zinc-200'">{{ task.text }}</span>

        <button
          type="button"
          class="shrink-0 cursor-pointer rounded p-0.5 text-zinc-500 opacity-0 transition hover:bg-zinc-700 hover:text-zinc-100 focus:opacity-100 group-hover/task:opacity-100"
          :aria-label="`Actions for ${task.text}`"
          aria-haspopup="menu"
          @click="openMenu($event, task, $event.currentTarget)"
        >
          <MoreHorizontal :size="15" />
        </button>
        <span v-if="i === items.length - 1 && showLineAfterLast" class="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 rounded bg-sky-400" />
      </li>

      <li v-if="!items.length" class="select-none px-2 py-6 text-center text-xs text-zinc-600">No tasks yet — type one below and press Enter.</li>
    </ul>

    <!-- Always at the bottom -->
    <div class="mt-2 shrink-0">
      <input
        v-model="draft"
        type="text"
        maxlength="500"
        placeholder="Add a task…"
        aria-label="Add a task"
        autocomplete="off"
        class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500"
        @keydown="onInputKey"
      />
    </div>

    <!-- Context menu: on a task, or (right click on empty space) the list menu -->
    <Teleport to="body">
      <div
        v-if="menu"
        ref="menuEl"
        role="menu"
        class="fixed z-[60] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 py-1 shadow-2xl shadow-black/50"
        :style="{ left: menu.x + 'px', top: menu.y + 'px', width: MENU_W + 'px' }"
        @contextmenu.prevent
      >
        <template v-if="menuTask">
          <button type="button" role="menuitem" :class="menuItem" @click="act(startEdit)">
            <Pencil :size="15" class="text-zinc-400" /> Edit label
          </button>
          <button type="button" role="menuitem" :class="menuItem" :disabled="menuIndex <= 0" @click="act(moveToTop)">
            <ArrowUpToLine :size="15" class="text-zinc-400" /> Move to top
          </button>
          <button type="button" role="menuitem" :class="menuItem" :disabled="menuIndex === items.length - 1" @click="act(moveToBottom)">
            <ArrowDownToLine :size="15" class="text-zinc-400" /> Move to bottom
          </button>
          <button type="button" role="menuitem" :class="menuItem" @click="act(toggleDone)">
            <component :is="menuTask.done ? CircleDashed : CircleCheck" :size="15" class="text-zinc-400" />
            {{ menuTask.done ? 'Mark as not completed' : 'Mark as completed' }}
          </button>
          <div class="my-1 border-t border-zinc-800" />
          <button type="button" role="menuitem" :class="[menuItem, '!text-red-300 hover:!bg-red-500/15 focus:!bg-red-500/15']" @click="act(remove)">
            <Trash2 :size="15" /> Remove task
          </button>
        </template>
        <button v-else type="button" role="menuitem" :class="menuItem" @click="act(openHistory)">
          <History :size="15" class="text-zinc-400" /> Show history
        </button>
      </div>
    </Teleport>

    <!-- History modal -->
    <Teleport to="body">
      <div v-if="histState.open" class="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" @mousedown.self="closeHistory">
        <div class="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl" role="dialog" aria-modal="true" aria-label="Task history">
          <header class="flex items-center gap-3 border-b border-zinc-800 px-5 py-4">
            <History :size="18" class="text-sky-300" />
            <h2 class="min-w-0 flex-1 text-base font-semibold text-zinc-100">Task history</h2>
            <select
              v-model="histState.filter"
              class="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-200 outline-none focus:border-sky-500"
              aria-label="Filter"
              @change="loadHistory(1)"
            >
              <option value="all">All tasks</option>
              <option value="completed">Completed only</option>
            </select>
            <button type="button" class="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Close" @click="closeHistory"><X :size="18" /></button>
          </header>

          <div class="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            <p v-if="histState.error" class="py-6 text-center text-sm text-red-300">{{ histState.error }}</p>
            <p v-else-if="!hist" class="py-6 text-center text-sm text-zinc-500">Loading…</p>
            <p v-else-if="!hist.rows.length" class="py-6 text-center text-sm text-zinc-500">No tasks in the history yet.</p>
            <table v-else class="w-full text-left text-sm" :class="histState.loading ? 'opacity-60' : ''">
              <thead class="text-[11px] uppercase tracking-wide text-zinc-500">
                <tr><th class="pb-2 pr-3 font-medium">Task</th><th class="pb-2 pr-3 font-medium">Created</th><th class="pb-2 font-medium">Completed</th></tr>
              </thead>
              <tbody class="divide-y divide-zinc-800/70">
                <tr v-for="r in hist.rows" :key="r.id" class="align-top">
                  <td class="max-w-[20rem] break-words py-2 pr-3 text-zinc-200">{{ r.text }}</td>
                  <td class="whitespace-nowrap py-2 pr-3 text-xs tabular-nums text-zinc-400">{{ fmtTime(r.createdAt) }}</td>
                  <td class="whitespace-nowrap py-2 text-xs tabular-nums" :class="r.completedAt ? 'text-emerald-300' : 'text-zinc-500'">
                    {{ r.completedAt ? fmtTime(r.completedAt) : r.removedAt ? 'Deleted' : 'Open' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <footer class="flex items-center justify-between gap-3 border-t border-zinc-800 px-5 py-3 text-xs text-zinc-400">
            <span>{{ hist ? `${hist.total} task${hist.total === 1 ? '' : 's'}` : '' }}</span>
            <div class="flex items-center gap-2">
              <button type="button" class="rounded-lg p-1.5 hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-35" :disabled="!hist || hist.page <= 1 || histState.loading" aria-label="Previous page" @click="loadHistory(hist.page - 1)">
                <ChevronLeft :size="16" />
              </button>
              <span class="tabular-nums">Page {{ hist?.page ?? 1 }} of {{ hist?.pages ?? 1 }}</span>
              <button type="button" class="rounded-lg p-1.5 hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-35" :disabled="!hist || hist.page >= hist.pages || histState.loading" aria-label="Next page" @click="loadHistory(hist.page + 1)">
                <ChevronRight :size="16" />
              </button>
            </div>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>
