/** Opens the memory panel from anywhere: the bubble, a desk, settings. */
export const OPEN_MEMORY = "perkos:open-memory";

export interface OpenMemory {
  /** "user" or a desk id; the person's own notes when absent. */
  scope?: string;
  /** How to show that scope before it has notes. */
  name?: string;
}

export function openMemory(detail: OpenMemory = {}) {
  window.dispatchEvent(new CustomEvent<OpenMemory>(OPEN_MEMORY, { detail }));
}
