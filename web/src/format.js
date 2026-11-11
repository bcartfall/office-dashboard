const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function bytes(n, digits = 1) {
  n = Number(n) || 0;
  let i = 0;
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : digits)} ${UNITS[i]}`;
}

export const rate = (n) => `${bytes(n)}/s`;
export const mb = (n) => bytes((Number(n) || 0) * 1024 * 1024);
export const pct = (n, digits = 0) => `${(Number(n) || 0).toFixed(digits)}%`;

/** Green -> amber -> red depending on load. */
export function loadColor(p) {
  if (p >= 90) return '#f87171';
  if (p >= 70) return '#fbbf24';
  return '#34d399';
}
