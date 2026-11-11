import { reactive, watch } from 'vue';
import { api } from '../api.js';
import { plugins as registry } from '../plugins/index.js';

const LS_KEY = 'office-dashboard:layout:v1';

export const state = reactive({
  panels: [], // grid items: { i, title, x, y, w, h, plugins: [{ id, type, config }] }
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

/** Accept whatever was persisted, repair it, and fill in new default settings. */
function sanitize(panels) {
  if (!Array.isArray(panels)) return null;
  return panels.map((p, n) => ({
    i: String(p.i ?? uid()),
    title: String(p.title ?? 'Panel'),
    x: Number.isFinite(p.x) ? p.x : 0,
    y: Number.isFinite(p.y) ? p.y : n * 6,
    w: Number.isFinite(p.w) ? p.w : 6,
    h: Number.isFinite(p.h) ? p.h : 6,
    plugins: (Array.isArray(p.plugins) ? p.plugins : [])
      .filter((pl) => pl && typeof pl.type === 'string')
      .map((pl) => ({
        id: String(pl.id ?? uid()),
        type: pl.type,
        config: { ...clone(registry[pl.type]?.defaults ?? {}), ...(pl.config ?? {}) },
      })),
  }));
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
  state.panels = sanitize(saved?.panels) ?? defaultPanels();
  state.ready = true;
  startAutosave();
}

let timer;
function startAutosave() {
  watch(
    () => state.panels,
    () => {
      clearTimeout(timer);
      timer = setTimeout(save, 600);
    },
    { deep: true }
  );
}

async function save() {
  const payload = { version: 1, panels: clone(state.panels) };
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

/** Move a plugin instance (keeping its config) to `toIndex` of any panel. */
export function movePlugin(fromPanelId, pluginId, toPanelId, toIndex) {
  const from = findPanel(fromPanelId);
  const to = findPanel(toPanelId);
  if (!from || !to) return;
  const idx = from.plugins.findIndex((p) => p.id === pluginId);
  if (idx < 0) return;
  const [item] = from.plugins.splice(idx, 1);
  const at = toIndex == null ? to.plugins.length : Math.max(0, Math.min(toIndex, to.plugins.length));
  to.plugins.splice(at, 0, item);
}

/** Shared drag state for plugin drag & drop between panels. */
export const dnd = reactive({ panelId: null, pluginId: null, overId: null });
