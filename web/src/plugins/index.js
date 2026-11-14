/**
 * Frontend plugin registry.
 *
 * Add a plugin by creating a Vue component that takes a `config` prop and
 * registering it here. Every instance placed in a panel gets its OWN copy of
 * `defaults`, so the same plugin can be added any number of times.
 *
 *  kind: 'widget' -> card with icon + title header (graphs, info)
 *        'tile'   -> compact button-style card (the component draws icon + title)
 *  settings: field descriptors rendered by SettingsModal
 *            { key, label, type: text|password|number|checkbox|select|ha-buttons,
 *              min, max, hint, placeholder, options | loadOptions }
 */
import CpuPlugin from './CpuPlugin.vue';
import MemoryPlugin from './MemoryPlugin.vue';
import DiskPlugin from './DiskPlugin.vue';
import GpuPlugin from './GpuPlugin.vue';
import LaunchAppPlugin from './LaunchAppPlugin.vue';
import HomeAssistantPlugin from './HomeAssistantPlugin.vue';
import CalendarPlugin from './CalendarPlugin.vue';
import JellyfinPlugin from './JellyfinPlugin.vue';
import TodoPlugin from './TodoPlugin.vue';
import NetworkPlugin from './NetworkPlugin.vue';
import CatPlugin from './CatPlugin.vue';
import { api } from '../api.js';
import { bytes } from '../format.js';

const interval = (def = 5) => ({
  key: 'intervalSeconds',
  label: 'Update interval (seconds)',
  type: 'number',
  min: 1,
  max: 3600,
  integer: true,
  default: def,
});
const history = {
  key: 'historyPoints',
  label: 'Graph history (samples)',
  type: 'number',
  min: 10,
  max: 600,
  integer: true,
  default: 60,
};

export const plugins = {
  cpu: {
    name: 'CPU Load',
    description: 'Total load graph, optional per-core bars',
    kind: 'widget',
    icon: 'cpu',
    component: CpuPlugin,
    defaults: { title: 'CPU Load', icon: 'cpu', intervalSeconds: 5, historyPoints: 60, showCores: false },
    settings: [interval(), history, { key: 'showCores', label: 'Show per-core bars', type: 'checkbox' }],
  },
  memory: {
    name: 'Memory',
    description: 'In use and available RAM',
    kind: 'widget',
    icon: 'memory',
    component: MemoryPlugin,
    defaults: { title: 'Memory', icon: 'memory', intervalSeconds: 5, historyPoints: 60, showSwap: false },
    settings: [interval(), history, { key: 'showSwap', label: 'Show swap usage', type: 'checkbox' }],
  },
  disk: {
    name: 'Disk',
    description: 'Usage, read and write speed',
    kind: 'widget',
    icon: 'disk',
    component: DiskPlugin,
    defaults: { title: 'Disk', icon: 'disk', intervalSeconds: 5, historyPoints: 60, mount: '' },
    settings: [
      {
        key: 'mount',
        label: 'Volume',
        type: 'select',
        loadOptions: async () => [
          { value: '', label: 'System volume (auto)' },
          ...(await api.get('/plugins/disk/mounts')).map((d) => ({ value: d.mount, label: `${d.mount} (${bytes(d.size)})` })),
        ],
      },
      interval(),
      history,
    ],
  },
  gpu: {
    name: 'GPU',
    description: 'Utilization and dedicated memory',
    kind: 'widget',
    icon: 'gpu',
    component: GpuPlugin,
    defaults: { title: 'GPU', icon: 'gpu', intervalSeconds: 5, historyPoints: 60, gpuIndex: 0 },
    settings: [
      {
        key: 'gpuIndex',
        label: 'GPU',
        type: 'select',
        numeric: true,
        loadOptions: async () => {
          const list = await api.get('/plugins/gpu/list');
          return list.length ? list.map((g) => ({ value: g.index, label: `${g.index}: ${g.name}` })) : [{ value: 0, label: 'No GPU detected' }];
        },
      },
      interval(),
      history,
    ],
  },
  network: {
    name: 'Network Speed',
    description: 'Adapter upload/download graph, link speed, Internet speed test',
    kind: 'widget',
    minHeight: 340,
    icon: 'network',
    component: NetworkPlugin,
    defaults: { title: 'Network', icon: 'network', iface: '', intervalSeconds: 3, historyPoints: 90, testMinutes: 30 },
    settings: [
      {
        key: 'iface',
        label: 'Network device',
        type: 'select',
        loadOptions: async () => [
          { value: '', label: 'Default adapter (auto)' },
          ...(await api.get('/plugins/network/interfaces')).map((n) => ({
            value: n.iface,
            label: `${n.iface}${n.description ? ` (${n.description})` : ''}${n.default ? ' - default' : ''}`,
          })),
        ],
      },
      { ...interval(3), label: 'Update interval (seconds)' },
      { ...history, label: 'Graph history (samples)', default: 90 },
      {
        key: 'testMinutes',
        label: 'Internet speed test every (minutes, 0 = off)',
        type: 'number',
        min: 0,
        max: 1440,
        integer: true,
        default: 30,
        hint: 'Each test downloads about 12 MB and uploads 4 MB, run by the server in the background (minimum 5 minutes). The first one runs as soon as the plugin is added. Adapter figures use no data.',
      },
    ],
  },
  cat: {
    name: 'Cat',
    description: 'A cat that follows your mouse. Click it!',
    kind: 'widget',
    minHeight: 200,
    basis: 220,
    icon: 'cat',
    component: CatPlugin,
    defaults: { title: 'Cat', icon: 'cat', sound: true, swatDistance: 130 },
    settings: [
      { key: 'sound', label: 'Play sounds (mew and purr)', type: 'checkbox' },
      {
        key: 'swatDistance',
        label: 'Swat distance (pixels)',
        type: 'number',
        min: 40,
        max: 600,
        integer: true,
        default: 130,
        hint: 'How close the pointer must get before the cat starts swatting at it.',
      },
    ],
  },
  'launch-app': {
    name: 'Launch App',
    description: 'Start a program, file or URL',
    kind: 'tile',
    icon: 'rocket',
    component: LaunchAppPlugin,
    defaults: { title: 'App', icon: 'rocket', command: '', args: '', hotkey: '', foreground: true },
    settings: [
      {
        key: 'command',
        label: 'Command / program / URL',
        type: 'text',
        placeholder: 'code   ·   C:\\Program Files\\App\\app.exe   ·   https://…',
        hint: 'Runs on the machine hosting the dashboard server. URLs open in the default browser.',
      },
      {
        key: 'args',
        label: 'Launch arguments',
        type: 'text',
        placeholder: '--new-window "C:\\My Projects"',
        hint: 'Space separated; use quotes for values containing spaces.',
      },
      {
        key: 'foreground',
        label: 'Bring the app to the foreground when launched',
        type: 'checkbox',
      },
      {
        key: 'hotkey',
        label: 'Hotkey',
        type: 'hotkey',
        hint: 'Shown in the tile’s top-right corner. Works while the dashboard tab is focused; the browser keeps its own shortcuts (Ctrl+T, Ctrl+W…), so prefer single keys, F-keys or Alt+key.',
      },
    ],
  },
  'home-assistant': {
    name: 'Home Assistant',
    description: 'Buttons that run Home Assistant actions',
    kind: 'widget',
    minHeight: 150,
    icon: 'home',
    component: HomeAssistantPlugin,
    defaults: { title: 'Home Assistant', icon: 'home', url: '', token: '', refreshSeconds: 10, buttons: [] },
    settings: [
      {
        key: 'url',
        label: 'Home Assistant URL',
        type: 'text',
        placeholder: 'http://homeassistant.local:8123',
        hint: 'Leave blank to use the HA_URL environment variable of the server.',
      },
      {
        key: 'token',
        label: 'Long-lived access token',
        type: 'password',
        hint: 'Create one under your HA profile. Blank = HA_TOKEN environment variable.',
      },
      { key: 'refreshSeconds', label: 'State refresh (seconds)', type: 'number', min: 2, max: 3600, integer: true, default: 10 },
      { key: 'buttons', label: 'Buttons', type: 'ha-buttons' },
    ],
  },
  calendar: {
    name: 'Calendar',
    description: 'Day list of events from your Google calendars',
    kind: 'widget',
    minHeight: 150,
    icon: 'calendar',
    component: CalendarPlugin,
    defaults: { title: 'Calendar', icon: 'calendar', refreshSeconds: 300, daysToShow: 1, calendars: [] },
    settings: [
      {
        key: 'calendars',
        label: 'Google calendars',
        type: 'calendars',
        hint: 'Read-only access through the Google Calendar API. Each calendar has its own color, shown before the event title.',
      },
      { key: 'daysToShow', label: 'Days to show (1 = today only)', type: 'number', min: 1, max: 14, integer: true, default: 1 },
      { key: 'refreshSeconds', label: 'Refresh interval (seconds)', type: 'number', min: 30, max: 86400, integer: true, default: 300 },
    ],
  },
  jellyfin: {
    name: 'Jellyfin',
    description: 'Up Next episodes — click one to play it in the Jellyfin desktop app',
    kind: 'widget',
    minHeight: 190,
    basis: 420,
    icon: 'tv',
    component: JellyfinPlugin,
    defaults: {
      title: 'Up Next',
      icon: 'tv',
      url: '',
      apiKey: '',
      userId: '',
      maxItems: 8,
      refreshSeconds: 120,
      desktopClient: 'Jellyfin Desktop|Jellyfin Media Player',
      desktopCommand: '',
      desktopArgs: '',
      foreground: true,
    },
    settings: [
      {
        key: 'url',
        label: 'Jellyfin server URL',
        type: 'text',
        placeholder: 'http://192.168.1.20:8096',
        hint: 'Your Jellyfin server on the local network.',
      },
      {
        key: 'apiKey',
        label: 'API key',
        type: 'password',
        hint: 'Jellyfin Dashboard → Advanced → API Keys → “+”. Stored in plain text in data/layout.json.',
      },
      { key: 'userId', label: 'Jellyfin user', type: 'jellyfin-user' },
      { key: 'maxItems', label: 'Episodes to show', type: 'number', min: 1, max: 40, integer: true, default: 8 },
      { key: 'refreshSeconds', label: 'Refresh interval (seconds)', type: 'number', min: 15, max: 86400, integer: true, default: 120 },
      {
        key: 'desktopCommand',
        label: 'Desktop app command (optional)',
        type: 'text',
        placeholder: 'C:\\Program Files\\Jellyfin Desktop\\jellyfin-desktop.exe',
        hint: 'Started on this machine when the Jellyfin desktop app isn’t running yet; the episode then plays once the app has signed in. Leave blank to only control an app that is already open.',
      },
      { key: 'desktopArgs', label: 'Desktop app arguments', type: 'text' },
      { key: 'foreground', label: 'Bring the Jellyfin app to the foreground when playing', type: 'checkbox' },
      {
        key: 'desktopClient',
        label: 'Desktop app client name(s)',
        type: 'text',
        hint: 'How the desktop app identifies itself to the server (Dashboard → Devices). Separate alternatives with |.',
      },
    ],
  },
  todo: {
    name: 'Todo List',
    description: 'Tasks you can reorder and check off',
    kind: 'widget',
    minHeight: 220,
    icon: 'todo',
    component: TodoPlugin,
    defaults: { title: 'Todo', icon: 'todo', items: [] },
    settings: [],
  },
};

export const pluginTypes = Object.keys(plugins);
