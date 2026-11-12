import { reactive, watch } from 'vue';
import { api } from '../api.js';
import { plugins as registry } from '../plugins/index.js';

const LS_KEY = 'office-dashboard:layout:v1';

export const DEFAULT_TITLE = 'Office Dashboard';

export const state = reactive({
  title: DEFAULT_TITLE, // browser tab / page title (set in Edit layout mode)
  // Grid items. Either a panel:            { i, title, x, y, w, h, plugins: [{ id, type, config }] }
  //             or a standalone plugin:    { i, x, y, w, h, plugin: { id, type, config } }
  panels: [],
  editing: false,
  ready: false,
  offline: false,
});

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const clone = (v) => JSON.parse(JSON.stringify(v));

export function createPlugin(type, overrides = {}) {
  const def = registry[type];
  return { id: uid(), type, config: { ...clone(def.defaults), ...overrides } };
}

function createPanel(title, plugins, pos) {
  return { i: uid(), title, plugins, x: 0, y: 0, w: 6, h: 6, ...pos };
}

function defaultPanels() {
  return [
    createPanel('System', [createPlugin('cpu'), createPlugin('memory')], { x: 0, y: 0, w: 6, h: 7 }),
    createPanel('Storage & Graphics', [createPlugin('disk'), createPlugin('gpu')], { x: 6, y: 0, w: 6, h: 7 }),
    createPanel(
      'Launcher',
      [
        createPlugin('launch-app', { title: 'VS Code', icon: 'code', command: 'code', args: '' }),
        createPlugin('launch-app', { title: 'Mail', icon: 'mail', command: 'https://mail.google.com', args: '' }),
        createPlugin('launch-app', { title: 'Calendar', icon: 'calendar', command: 'https://calendar.google.com', args: '' }),
        createPlugin('launch-app', { title: 'New app', icon: 'rocket' }),
      ],
      { x: 0, y: 7, w: 6, h: 5 }
    ),
    createPanel('Home Assistant', [createPlugin('home-assistant')], { x: 6, y: 7, w: 6, h: 5 }),
  ];
}

function sanitizePlugin(pl) {
  const config = { ...clone(registry[pl.type]?.defaults ?? {}), ...(pl.config ?? {}) };
  // Calendars used to be ICS feeds ({ url }); they are Google calendars now, so drop the old entries.
  if (pl.type === 'calendar') config.calendars = (Array.isArray(config.calendars) ? config.calendars : []).filter((c) => c && c.id && !c.url);
  return { id: String(pl.id ?? uid()), type: pl.type, config };
}

/** Accept whatever was persisted, repair it, and fill in new default settings. */
function sanitize(panels) {
  if (!Array.isArray(panels)) return null;
  return panels.map((p, n) => {
    const pos = {
      i: String(p.i ?? uid()),
      x: Number.isFinite(p.x) ? p.x : 0,
      y: Number.isFinite(p.y) ? p.y : n * 6,
      w: Number.isFinite(p.w) ? p.w : 6,
      h: Number.isFinite(p.h) ? p.h : 6,
    };
    if (p.plugin && typeof p.plugin.type === 'string') return { ...pos, plugin: sanitizePlugin(p.plugin) };
    return {
      ...pos,
      title: String(p.title ?? 'Panel'),
      plugins: (Array.isArray(p.plugins) ? p.plugins : []).filter((pl) => pl && typeof pl.type === 'string').map(sanitizePlugin),
    };
  });
}

export async function load() {
  let saved = null;
  try {
    saved = (await api.get('/layout')).layout;
    state.offline = false;
  } catch {
    state.offline = true;
  }
  if (!saved) {
    try {
      saved = JSON.parse(localStorage.getItem(LS_KEY));
    } catch {
      /* storage unavailable or corrupt */
    }
  }
  state.title = typeof saved?.title === 'string' ? saved.title.slice(0, 60) : DEFAULT_TITLE;
  state.panels = sanitize(saved?.panels) ?? defaultPanels();
  state.ready = true;
  startAutosave();
}

let timer;
function startAutosave() {
  watch(
    () => [state.panels, state.title],
    () => {
      clearTimeout(timer);
      timer = setTimeout(save, 600);
    },
    { deep: true }
  );
}

async function save() {
  const payload = { version: 1, title: state.title, panels: clone(state.panels) };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
  try {
    await api.put('/layout', { layout: payload });
    state.offline = false;
  } catch {
    state.offline = true;
  }
}

// ---- mutations --------------------------------------------------------------
const findPanel = (id) => state.panels.find((p) => p.i === id);

export function addPanel() {
  const bottom = state.panels.reduce((m, p) => Math.max(m, p.y + p.h), 0);
  state.panels.push(createPanel('New panel', [], { x: 0, y: bottom, w: 6, h: 5 }));
}

/** Default grid size of a plugin that lives outside a panel. */
function standaloneSize(type) {
  return registry[type]?.kind === 'tile' ? { w: 2, h: 3 } : { w: 4, h: 7 };
}

function createStandalone(plugin, pos = {}) {
  const bottom = state.panels.reduce((m, p) => Math.max(m, p.y + p.h), 0);
  const item = { i: uid(), x: 0, y: bottom, ...standaloneSize(plugin.type), ...pos, plugin };
  item.x = Math.max(0, Math.min(item.x, 12 - item.w)); // keep it inside the 12-column grid
  return item;
}

/** Add a plugin directly to the dashboard grid (no panel around it). */
export function addStandalonePlugin(type) {
  state.panels.push(createStandalone(createPlugin(type)));
}

export function removePanel(id) {
  const idx = state.panels.findIndex((p) => p.i === id);
  if (idx >= 0) state.panels.splice(idx, 1);
}

export function addPlugin(panelId, type) {
  findPanel(panelId)?.plugins.push(createPlugin(type));
}

export function removePlugin(panelId, pluginId) {
  const panel = findPanel(panelId);
  if (!panel) return;
  const idx = panel.plugins.findIndex((p) => p.id === pluginId);
  if (idx >= 0) panel.plugins.splice(idx, 1);
}

/**
 * Move a plugin instance (keeping its config) to `toIndex` of a panel. `fromId` is the grid item it
 * currently lives in: a panel, or a standalone plugin (which disappears once it is inside the panel).
 */
export function movePlugin(fromId, pluginId, toPanelId, toIndex) {
  const from = findPanel(fromId);
  const to = findPanel(toPanelId);
  if (!from || !to || !to.plugins) return;
  let item;
  if (from.plugin) {
    if (from.plugin.id !== pluginId) return;
    item = from.plugin;
    state.panels.splice(state.panels.indexOf(from), 1);
  } else {
    const idx = from.plugins.findIndex((p) => p.id === pluginId);
    if (idx < 0) return;
    [item] = from.plugins.splice(idx, 1);
  }
  const at = toIndex == null ? to.plugins.length : Math.max(0, Math.min(toIndex, to.plugins.length));
  to.plugins.splice(at, 0, item);
}

/** Take a plugin out of its panel and place it on the grid by itself at `pos` ({ x, y }). */
export function detachPlugin(fromPanelId, pluginId, pos) {
  const from = findPanel(fromPanelId);
  const idx = from?.plugins?.findIndex((p) => p.id === pluginId) ?? -1;
  if (idx < 0) return;
  const [plugin] = from.plugins.splice(idx, 1);
  state.panels.push(createStandalone(plugin, pos));
}

/** Shared drag state for plugin drag & drop between panels. */
// panelId = id of the grid item (panel or standalone plugin) the dragged plugin comes from.
export const dnd = reactive({ panelId: null, pluginId: null, overId: null });
