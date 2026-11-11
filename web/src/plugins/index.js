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
  'launch-app': {
    name: 'Launch App',
    description: 'Start a program, file or URL',
    kind: 'tile',
    icon: 'rocket',
    component: LaunchAppPlugin,
    defaults: { title: 'App', icon: 'rocket', command: '', args: '' },
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
    description: 'Day list of events from one or more ICS calendars',
    kind: 'widget',
    minHeight: 150,
    icon: 'calendar',
    component: CalendarPlugin,
    defaults: { title: 'Calendar', icon: 'calendar', refreshSeconds: 300, daysToShow: 1, calendars: [] },
    settings: [
      {
        key: 'calendars',
        label: 'Calendars',
        type: 'calendars',
        hint: 'Each calendar has its own ICS URL and color; the color appears before the event title. Private ICS URLs are stored in plain text in data/layout.json.',
      },
      { key: 'daysToShow', label: 'Days to show (1 = today only)', type: 'number', min: 1, max: 14, integer: true, default: 1 },
      { key: 'refreshSeconds', label: 'Refresh interval (seconds)', type: 'number', min: 30, max: 86400, integer: true, default: 300 },
    ],
  },
};

export const pluginTypes = Object.keys(plugins);
