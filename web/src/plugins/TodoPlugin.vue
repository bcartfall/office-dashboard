<script setup>
import { ref, computed, nextTick, onBeforeUnmount } from 'vue';
import { Check, GripVertical, MoreHorizontal, ArrowUpToLine, ArrowDownToLine, CircleCheck, CircleDashed, Trash2 } from 'lucide-vue-next';

// Tasks live in this instance's config (config.items), so they are saved with the layout like every other setting.
const props = defineProps({ config: { type: Object, required: true }, instanceId: { type: String, default: '' } });

const items = computed(() => {
  if (!Array.isArray(props.config.items)) props.config.items = [];
  return props.config.items;
});

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const indexOf = (id) => items.value.findIndex((t) => t.id === id);
const remaining = computed(() => items.value.filter((t) => !t.done).length);

// ---- add -------------------------------------------------------------------
const draft = ref('');
const list = ref(null);

async function add() {
  const text = draft.value.trim();
  if (!text) return;
  items.value.push({ id: uid(), text, done: false });
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
function toggleDone(id) {
  const t = items.value.find((x) => x.id === id);
  if (t) t.done = !t.done;
}
function remove(id) {
  const i = indexOf(id);
  if (i >= 0) items.value.splice(i, 1);
}

// Keyboard reordering: Alt + Arrow Up / Down on a focused task.
function onRowKey(e, task) {
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

// ---- context menu ----------------------------------------------------------
const MENU_W = 200;
const MENU_H = 148;
const menu = ref(null); // { id, x, y }
const menuEl = ref(null);
const menuTask = computed(() => items.value.find((t) => t.id === menu.value?.id));
const menuIndex = computed(() => (menu.value ? indexOf(menu.value.id) : -1));

function openMenu(e, task, anchor) {
  e.preventDefault();
  e.stopPropagation();
  const rect = anchor?.getBoundingClientRect();
  const px = rect ? rect.right : e.clientX;
  const py = rect ? rect.bottom : e.clientY;
  const x = Math.max(8, Math.min(window.innerWidth - MENU_W - 8, rect ? px - MENU_W : px));
  const y = Math.max(8, Math.min(window.innerHeight - MENU_H - 8, py));
  menu.value = { id: task.id, x, y };
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
const onOutside = (e) => {
  if (!menuEl.value?.contains(e.target)) closeMenu();
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
  if (id) fn(id);
}
onBeforeUnmount(closeMenu);

const menuItem =
  'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800 focus:bg-zinc-800 focus:outline-none disabled:pointer-events-none disabled:opacity-35';
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
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
        draggable="true"
        class="group/task relative flex items-start gap-1.5 rounded-lg py-1 pl-0.5 pr-1 outline-none transition hover:bg-zinc-800/60 focus-visible:ring-1 focus-visible:ring-sky-500/70"
        :class="drag.id === task.id ? 'opacity-40' : ''"
        @dragstart="onDragStart($event, task)"
        @dragend="endDrag"
        @dragover="onRowDragOver($event, i)"
        @drop="onDrop"
        @contextmenu="openMenu($event, task)"
        @keydown="onRowKey($event, task)"
      >
        <span v-if="showLineBefore(i)" class="pointer-events-none absolute inset-x-0 -top-px h-0.5 rounded bg-sky-400" />
        <GripVertical :size="14" class="mt-1 shrink-0 cursor-grab text-zinc-700 transition group-hover/task:text-zinc-500" aria-hidden="true" />

        <label class="mt-px flex shrink-0 cursor-pointer items-center" :title="task.done ? 'Mark as not completed' : 'Mark as completed'">
          <input v-model="task.done" type="checkbox" class="peer sr-only" :aria-label="`Completed: ${task.text}`" />
          <span
            class="grid size-4 place-items-center rounded border transition peer-focus-visible:ring-2 peer-focus-visible:ring-sky-400/70"
            :class="task.done ? 'border-sky-500 bg-sky-500 text-zinc-950' : 'border-zinc-600 bg-zinc-950 hover:border-sky-400'"
          >
            <Check v-if="task.done" :size="12" stroke-width="3.5" />
          </span>
        </label>

        <span class="min-w-0 flex-1 select-text whitespace-pre-wrap break-words text-sm leading-5" :class="task.done ? 'text-zinc-500 line-through decoration-zinc-600' : 'text-zinc-200'">{{ task.text }}</span>

        <button
          type="button"
          class="shrink-0 rounded p-0.5 text-zinc-500 opacity-0 transition hover:bg-zinc-700 hover:text-zinc-100 focus:opacity-100 group-hover/task:opacity-100"
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
      <p v-if="items.length" class="mt-1 px-1 text-[10px] text-zinc-600">{{ remaining }} of {{ items.length }} remaining</p>
    </div>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="menu && menuTask"
        ref="menuEl"
        role="menu"
        class="fixed z-[60] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 py-1 shadow-2xl shadow-black/50"
        :style="{ left: menu.x + 'px', top: menu.y + 'px', width: MENU_W + 'px' }"
        @contextmenu.prevent
      >
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
      </div>
    </Teleport>
  </div>
</template>
