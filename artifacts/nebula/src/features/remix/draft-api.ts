import { useQuery } from '@tanstack/react-query';
import { apiRequest, type RemixDraft, type RemixDraftUpdate } from '@nebula/local';
import { useAuth } from '@/context/AuthContext';

const pointerKey = 'nebula-active-remix';
let memory: { owner: number; id: string } | null = null;
window.addEventListener('nebula-session-identity', event => { if ((event as CustomEvent).detail !== memory?.owner) memory = null; });
export function activeDraft(owner: number) {
  try { const value = JSON.parse(sessionStorage.getItem(pointerKey) ?? 'null'); return value?.owner === owner && typeof value.id === 'string' ? value.id : null; }
  catch { return memory?.owner === owner ? memory.id : null; }
}
export function selectDraft(owner: number, id: string | null) {
  memory = id ? { owner, id } : null;
  try { if (id) sessionStorage.setItem(pointerKey, JSON.stringify(memory)); else sessionStorage.removeItem(pointerKey); } catch { /* Per-tab memory fallback. */ }
}
export function useRemixDraft(id?: string | null) {
  const { user } = useAuth();
  return useQuery({ queryKey: ['remix-draft', user?.artistId, id], queryFn: () => apiRequest<RemixDraft>(`/api/remix-drafts/${id}`), enabled: user?.role === 'artist' && !!id, refetchOnWindowFocus: false, staleTime: 0 });
}
export function createDraft(sourceId: number, sourceRevision: number, requestKey: string) {
  return apiRequest<RemixDraft>('/api/remix-drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId, sourceRevision, requestKey }) });
}
export function saveDraft(id: string, data: RemixDraftUpdate, signal: AbortSignal) {
  return apiRequest<RemixDraft>(`/api/remix-drafts/${id}`, { method: 'PATCH', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}
export function prepareRender(id: string, revision: number, signal: AbortSignal) {
  return apiRequest<RemixDraft>(`/api/remix-drafts/${id}`, { method: 'PATCH', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, action: 'prepare-render' }) });
}
