/** Shared bits of the `background` hook for the graph plugins (cpu, memory, disk, gpu). */
export const everySeconds = (config) => Number(config?.intervalSeconds) || 5;
export const keepPoints = (config) => Number(config?.historyPoints) || 60;
