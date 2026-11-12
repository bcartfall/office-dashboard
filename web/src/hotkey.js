/**
 * Keyboard shortcut helpers. A shortcut is stored as text such as "Ctrl+Alt+K", "Shift+2" or "F6".
 * Browsers can't register global hotkeys: these only fire while the dashboard tab has focus, and
 * the browser keeps its own shortcuts (Ctrl+T, Ctrl+W, ...).
 */
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS']);
const NAMES = { ' ': 'Space', Escape: 'Esc', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };

/** Normalised combo for a keyboard event, or '' while only modifiers are held. */
export function comboFromEvent(e) {
  if (MODIFIER_KEYS.has(e.key)) return '';
  let key = e.key;
  // With Alt held the produced character can be something exotic (macOS); use the physical key instead.
  if (e.altKey && /^(Key[A-Z]|Digit\d)$/.test(e.code)) key = e.code.slice(-1);
  key = NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && !(key.length === 1 && !/[A-Z0-9]/.test(key))) parts.push('Shift'); // Shift+1 -> "!" is already shifted
  if (e.metaKey) parts.push('Meta');
  parts.push(key);
  return parts.join('+');
}

export const normalizeCombo = (s) => String(s || '').trim().toLowerCase();

/** True when focus is somewhere text is typed, where shortcuts must not fire. */
export function isTypingTarget(el) {
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
