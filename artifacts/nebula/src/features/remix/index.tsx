import { ReturnLink, ReturnButton } from '@/components/antiq/workspace';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, isServerMode, type RemixDraft } from '@nebula/local';
import { useAuth } from '@/context/AuthContext';
import { usePublication } from '@/features/discovery/publication-api';
import { ProjectOffers } from '@/features/collaborations';
import { activeDraft, createDraft, selectDraft, useRemixDraft } from './draft-api';
import { Studio } from './studio';
const button = 'border border-border px-5 py-3 text-sm hover:border-accent disabled:opacity-40';

/** Old GET links only resolve context; an explicit action is required to create a draft. */
export function LegacyRemixPage({ proposal = false }: { proposal?: boolean }) {
  const { id } = useParams<{ id: string }>(), [, navigate] = useLocation();
  useEffect(() => { navigate('/studio/remix', { replace: true, state: proposal ? { legacyPublicationId: Number(id) } : { sourceId: Number(id) } }); }, [id, proposal, navigate]);
  return <p className="p-8" role="status">Opening Remix studio…</p>;
}
export function RemixPage({ proposal = false }: { proposal?: boolean }) {
  const { user } = useAuth();
  if (!isServerMode() || user?.role !== 'artist') return <section className="p-8 space-y-4"><h1 className="text-3xl">Remix studio</h1><p>Log in as an artist to open your private workspace.</p><Link className="underline" href="/login">Log in</Link><Link className="underline ml-4" href="/register">Sign up</Link></section>;
  return <Workspace key={user.artistId} owner={user.artistId!} proposal={proposal} />;
}
function Workspace({ owner, proposal }: { owner: number; proposal: boolean }) {
  const client = useQueryClient(), [, navigate] = useLocation();
  const entry = useRef(window.history.state as { sourceId?: number; start?: boolean; legacyPublicationId?: number; requestKey?: string } | null);
  const [selected, setSelected] = useState<string | null>(() => entry.current?.sourceId || entry.current?.legacyPublicationId ? null : activeDraft(owner));
  const [error, setError] = useState(''), [pending, setPending] = useState(false), started = useRef(false), requestKey = useRef(entry.current?.requestKey ?? crypto.randomUUID());
  const draft = useRemixDraft(selected), list = useQuery({ queryKey: ['remix-drafts',owner], queryFn: () => apiRequest<{ items: RemixDraft[] }>('/api/remix-drafts'), enabled: !selected, refetchOnWindowFocus: false });
  const sourceId = draft.data?.settings.sourceId ?? entry.current?.sourceId;
  const original = usePublication(sourceId, false, false);
  const legacy = usePublication(entry.current?.legacyPublicationId);
  const validOriginal = original.data?.status === 'published' && original.data.allowRemix && !original.data.remix && ['audio','video'].includes(original.data.media.kind);
  async function start() {
    if (!original.data || pending) return; setPending(true); setError('');
    // Keep the operation key across a reload after a lost create response.
    window.history.replaceState({ ...entry.current, requestKey: requestKey.current }, '');
    try {
      const result = await createDraft(original.data.id, original.data.revision, requestKey.current);
      client.setQueryData(['remix-draft',owner,result.id],result); selectDraft(owner,result.id); setSelected(result.id);
      window.history.replaceState(null,''); entry.current = null;
    } catch (cause) { setError((cause as Error).message); }
    finally { setPending(false); }
  }
  useEffect(() => { if (entry.current?.start && validOriginal && !started.current) { started.current = true; void start(); } }, [validOriginal]);
  function drafts() { selectDraft(owner,null); setSelected(null); entry.current=null; window.history.replaceState(null,''); navigate('/studio/remix'); void list.refetch(); }
  if (draft.data && original.data && !proposal) {
    if (!validOriginal || original.data.revision !== draft.data.settings.sourceRevision) return <section className="p-6 space-y-4"><h1 className="text-3xl">Remix unavailable</h1><p>The original changed or remix permission was revoked. Your private draft has been preserved.</p><ReturnButton onClick={drafts}>Your private drafts</ReturnButton><Link className={button} href="/discovery">Find an original</Link></section>;
    return <Studio key={draft.data.id} original={original.data} draft={draft.data} onDrafts={drafts} />;
  }
  if (proposal && draft.data) return <section className="mx-auto max-w-3xl p-6 space-y-6"><ReturnLink href="/studio/remix">Back to Remix studio</ReturnLink><h1 className="text-3xl">Propose your remix</h1><p>{draft.data.title} · Remix of {draft.data.attribution.title} by {draft.data.attribution.artistName}</p>{draft.data.render && draft.data.attribution.projectId ? <ProjectOffers projectId={draft.data.attribution.projectId} proposalDraftId={draft.data.id} /> : <p>Save a preview of a remix linked to a project before proposing it.</p>}</section>;
  if (legacy.data?.remix && legacy.data.artistId === owner) return <section className="p-6 space-y-4"><h1 className="text-3xl">Previously saved remix</h1><p>This older remix contains only the finished mix. Its editable tracks were not saved.</p><p>{legacy.data.title}</p>{legacy.data.remix.projectId && <ProjectOffers projectId={legacy.data.remix.projectId} proposalPublicationId={legacy.data.id} />}<ReturnButton onClick={drafts}>Your private drafts</ReturnButton></section>;
  return <section className="mx-auto w-full max-w-3xl p-6 space-y-6"><ReturnLink href="/studio" /><h1 className="text-3xl font-bold">Remix studio</h1><p className="text-muted">Your private drafts. Keep editing, then share a finished mix with a project through a proposal.</p>
    {(pending || original.isLoading || draft.isLoading || list.isLoading) && <p role="status">Opening your workspace…</p>}
    {(error || draft.error || original.error || list.error || legacy.error) && <div role="alert" className="space-y-3"><p>{error || draft.error?.message || original.error?.message || list.error?.message || legacy.error?.message}</p><button className={button} onClick={() => { if (selected) void draft.refetch(); else { void original.refetch(); void list.refetch(); } }}>Retry</button><ReturnButton onClick={drafts}>Your private drafts</ReturnButton></div>}
    {entry.current?.sourceId && original.data && <div className="space-y-3"><p>Original: {original.data.title} · {original.data.artistName}</p>{validOriginal ? <button className={button} disabled={pending} onClick={() => void start()}>Start private remix</button> : <p>This original is not available for remixing.</p>}</div>}
    <Link className={`${button} inline-block`} href="/discovery">Find an original</Link>
    {!selected && list.data?.items.map(item => <article key={item.id} className="border border-border p-4 space-y-3"><h2 className="font-semibold">{item.title}</h2><p className="text-sm text-muted">Original: {item.attribution.title} · {item.attribution.artistName}</p><p className="text-sm">{item.render ? 'Preview saved' : 'Work in progress'} · {new Date(item.updatedAt).toLocaleString()}</p><button className={button} onClick={() => { selectDraft(owner,item.id); setSelected(item.id); entry.current=null; window.history.replaceState(null,''); }}>Resume draft</button></article>)}
    {!selected && list.data?.items.length === 0 && <p>No private drafts yet. Choose an original in Discovery to start.</p>}
  </section>;
}
