import { useRef, useState, type SetStateAction } from 'react';
import { getLocalStore } from '@nebula/local';

const prefix = 'nebula-collaboration-draft:';
const memory = new Map<string, unknown>();
// Per-tab working copies, never public data or an authorization source. Media
// entries refer only to uploads already accepted by the existing server.
export function clearCollaborationDrafts() {
  memory.clear();
  try { Object.keys(sessionStorage).filter(key => key.startsWith(prefix)).forEach(key => sessionStorage.removeItem(key)); } catch { /* Memory-only fallback. */ }
}
export function useWorkspaceDraft<T>(key: string, initial: T) {
  const owner = getLocalStore().getCurrentUser()?.artistId;
  const storageKey = `${prefix}${owner}:${key}`;
  const [value, setValue] = useState<T>(() => {
    if (memory.has(storageKey)) return memory.get(storageKey) as T;
    try { const saved = sessionStorage.getItem(storageKey); if (saved !== null) return JSON.parse(saved) as T; } catch { /* Keep editing if storage is unavailable. */ }
    return initial;
  });
  const current = useRef(value);
  function update(next: SetStateAction<T>) {
    const result = typeof next === 'function' ? (next as (value: T) => T)(current.current) : next;
    current.current = result; setValue(result);
    if (getLocalStore().getCurrentUser()?.artistId !== owner) return;
    memory.set(storageKey, result);
    try { sessionStorage.setItem(storageKey, JSON.stringify(result)); } catch { /* In-memory navigation still works. */ }
  }
  function discard() {
    memory.delete(storageKey);
    try { sessionStorage.removeItem(storageKey); } catch { /* Memory-only fallback. */ }
  }
  return [value, update, discard] as const;
}
