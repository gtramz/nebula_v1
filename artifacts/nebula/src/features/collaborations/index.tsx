import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams, useSearch } from 'wouter';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, isServerMode, type CollaborationOffer, type OfferInput, type Compensation, type Collaboration, type CollaborationDetail, type UploadedMedia } from '@nebula/local';
import { useAuth } from '@/context/AuthContext';
import { uploadMedia } from '@/features/discovery/publication-api';
import { usePublication } from '@/features/discovery/publication-api';
import { formatMoney } from '@/lib/utils';

const field = 'w-full border border-border bg-surfaceAlt px-4 py-3 text-sm text-ink';
const button = 'border border-border px-4 py-3 text-sm hover:border-accent disabled:opacity-40';
const primary = `${button} bg-cream text-bg font-semibold`;
const statusText = (value: string) => value.replaceAll('_', ' ');
const identity = (user: ReturnType<typeof useAuth>['user']) => user ? `${user.role}:${user.artistId ?? user.investorId}` : 'guest';
async function write<T>(path: string, method: string, data: object): Promise<T> { return apiRequest<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); }
async function refresh(client: ReturnType<typeof useQueryClient>) { await Promise.all(['offers','collaborations','collaboration','publication','discovery-feed'].map(key => client.invalidateQueries({ queryKey: [key] }))); }
function ErrorMessage({ error }: { error: unknown }) { return error ? <p role="alert" className="text-sm text-danger">{error instanceof Error ? error.message : String(error)}</p> : null; }
export function CompensationText({ value }: { value: Compensation }) { return <>{value.kind === 'split' ? `${value.percent}% royalty split offered` : `${formatMoney(value.amount)} fixed fee`}</>; }
function Terms({ offer }: { offer: CollaborationOffer }) {
  return <div className="space-y-3 text-sm"><p className="text-accent"><CompensationText value={offer.compensation} /></p><p className="whitespace-pre-wrap break-words"><strong>Deliverable: </strong>{offer.deliverable}</p>{offer.requirements && <p className="whitespace-pre-wrap break-words"><strong>Requirements & terms: </strong>{offer.requirements}</p>}<p className="text-muted">{offer.deadline ? `Apply by ${offer.deadline} (UTC)` : 'No application deadline'}</p></div>;
}

export function ProjectOffers({ projectId, ownerId, compact = false, proposalPublicationId }: { projectId: number; ownerId?: number; compact?: boolean; proposalPublicationId?: number }) {
  const { user } = useAuth(), client = useQueryClient(), [, navigate] = useLocation();
  const [editing, setEditing] = useState<CollaborationOffer | 'new' | null>(null), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const query = useQuery({ queryKey: ['offers', projectId, identity(user)], queryFn: () => apiRequest<CollaborationOffer[]>(`/api/projects/${projectId}/offers`), enabled: isServerMode(), refetchInterval: 15_000, refetchOnWindowFocus: true });
  if (!isServerMode()) return null;
  const mine = user?.artistId === ownerId;
  async function openConversation(offer: CollaborationOffer) {
    if (pending) return; setPending(true); setError('');
    try { const result = await write<Collaboration>(`/api/offers/${offer.id}/conversations`, 'POST', {}); navigate(`/collaborations/${result.id}${proposalPublicationId ? `?publication=${proposalPublicationId}` : ''}`); }
    catch (error) { setError((error as Error).message); } finally { setPending(false); }
  }
  return <section aria-label="Collaboration offers" className="space-y-5 border-t border-border pt-6">
    <div className="flex flex-wrap justify-between gap-3"><div><p className="voice text-xs text-accent">COLLABORATIONS</p><h2 className="text-2xl font-bold">Make it together.</h2></div>{mine && !compact && <button className={button} onClick={() => setEditing('new')}>New offer</button>}</div>
    <p className="text-sm text-muted">One offer per need. Remix permission is separate; a remix does not grant a collaboration or royalties.</p>
    {mine && compact && <Link href={`/project/${projectId}`} className="underline text-sm">Manage collaboration offers</Link>}
    <ErrorMessage error={error || query.error} />{query.error && <button className={button} onClick={() => void query.refetch()}>Retry offers</button>}
    {query.isLoading && <p role="status">Loading offers…</p>}
    {editing && <OfferEditor key={editing === 'new' ? 'new' : `${editing.id}-${editing.revision}`} projectId={projectId} existing={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    {!query.isLoading && !query.error && !query.data?.length && <p className="text-sm text-muted">{mine ? 'Create an offer to invite another artist into this project.' : 'No open collaboration offers.'}</p>}
    {query.data?.map(offer => <article key={offer.id} aria-label={`${offer.need} offer`} className="border border-border p-5 space-y-4">
      <div className="flex justify-between gap-3"><h3 className="text-xl font-semibold">{offer.need}</h3><span className="text-xs text-muted">{offer.available ? 'open call' : offer.status === 'closed' ? 'closed' : 'not accepting applications'}</span></div>
      <Terms offer={offer} />
      {mine ? !compact && <div className="flex flex-wrap gap-2"><button className={button} onClick={() => setEditing(offer)}>Edit offer</button>{offer.status === 'open' && <button className={button} disabled={pending} onClick={async () => { setPending(true); setError(''); try { await write(`/api/offers/${offer.id}`, 'PATCH', { revision: offer.revision, action: 'close' }); await refresh(client); } catch (error) { setError((error as Error).message); } finally { setPending(false); } }}>Close offer</button>}<Link href="/collaborations" className={button}>Review proposals</Link></div>
        : user?.role === 'artist' ? <div className="flex flex-wrap gap-2"><button className={button} disabled={pending || !offer.available} onClick={() => void openConversation(offer)}>Contact artist</button><button className={primary} disabled={pending || !offer.available} onClick={() => void openConversation(offer)}>Submit proposal</button></div>
        : user ? <p className="text-sm text-muted">An artist account is required to apply.</p> : <div className="flex gap-4 text-sm underline"><Link href="/login">Log in to collaborate</Link><Link href="/register">Create artist account</Link></div>}
    </article>)}
  </section>;
}

function OfferEditor({ projectId, existing, onClose }: { projectId: number; existing?: CollaborationOffer; onClose: () => void }) {
  const client = useQueryClient();
  const [value, setValue] = useState<OfferInput>(existing ?? { need: 'Verse', deliverable: '', requirements: '', deadline: null, status: 'open', compensation: { kind: 'split', percent: 10 } });
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  return <form aria-label="Offer editor" className="border border-accent p-5 space-y-4" onSubmit={async event => {
    event.preventDefault(); if (pending) return; setPending(true); setError('');
    try { await write(existing ? `/api/offers/${existing.id}` : `/api/projects/${projectId}/offers`, existing ? 'PATCH' : 'POST', { ...value, revision: existing?.revision }); await refresh(client); onClose(); } catch (error) { setError((error as Error).message); } finally { setPending(false); }
  }}>
    <h3 className="text-lg font-bold">{existing ? 'Edit collaboration offer' : 'New collaboration offer'}</h3>
    <label className="block space-y-2">Looking for<select className={field} value={value.need} onChange={e => setValue({ ...value, need: e.target.value as OfferInput['need'] })}>{['Verse','Feature','Production','Mix','Master'].map(need => <option key={need}>{need}</option>)}</select></label>
    <label className="block space-y-2">Expected deliverable<textarea className={field} required maxLength={2000} rows={3} value={value.deliverable} onChange={e => setValue({ ...value, deliverable: e.target.value })} /></label>
    <label className="block space-y-2">Requirements and terms<textarea className={field} maxLength={4000} rows={4} placeholder="Style, language, file format, revisions, credit and payment or royalty conditions." value={value.requirements} onChange={e => setValue({ ...value, requirements: e.target.value })} /></label>
    <div className="grid sm:grid-cols-2 gap-4"><label className="block space-y-2">Compensation<select className={field} value={value.compensation.kind} onChange={e => setValue({ ...value, compensation: e.target.value === 'split' ? { kind: 'split', percent: 10 } : { kind: 'fee', amount: 100, currency: 'USD' } })}><option value="split">Royalty split</option><option value="fee">Fixed fee (USD)</option></select></label>
    <label className="block space-y-2">{value.compensation.kind === 'split' ? 'Royalty percentage' : 'Fee in USD'}<input className={field} required type="number" min="0.01" max={value.compensation.kind === 'split' ? 100 : 1000000} step="0.01" value={value.compensation.kind === 'split' ? value.compensation.percent : value.compensation.amount} onChange={e => setValue({ ...value, compensation: value.compensation.kind === 'split' ? { kind: 'split', percent: Number(e.target.value) } : { kind: 'fee', amount: Number(e.target.value), currency: 'USD' } })} /></label></div>
    <label className="block space-y-2">Application deadline (optional, UTC)<input className={field} type="date" min={new Date().toISOString().slice(0,10)} value={value.deadline ?? ''} onChange={e => setValue({ ...value, deadline: e.target.value || null })} /></label>
    <label className="block space-y-2">Offer status<select className={field} value={value.status} onChange={e => setValue({ ...value, status: e.target.value as OfferInput['status'] })}><option value="open">Open — looking for collaborators</option><option value="closed">Closed</option></select></label>
    <p className="text-sm text-muted">Publish the project to make open offers visible. Submitted proposals keep the terms they were sent under. Fees and splits are offers; this platform does not collect payments or distribute royalties.</p>
    <ErrorMessage error={error} /><div className="flex gap-3"><button className={primary} disabled={pending}>{pending ? 'Saving…' : 'Save offer'}</button><button type="button" className={button} disabled={pending} onClick={onClose}>Cancel</button></div>
  </form>;
}

function ArtistAccess({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!isServerMode()) return <p className="p-8">Collaborations require the local server.</p>;
  if (!user) return <div className="p-8 space-y-4"><p>Log in as an artist to view your collaborations.</p><Link className="underline" href="/login">Log in</Link></div>;
  if (user.role !== 'artist') return <p className="p-8">Collaborations are available to artist accounts.</p>;
  return <>{children}</>;
}
export function CollaborationsPage() { return <ArtistAccess><CollaborationList /></ArtistAccess>; }
function CollaborationList() {
  const { user } = useAuth(); const [tab, setTab] = useState<'received' | 'sent'>('received');
  const query = useInfiniteQuery({ queryKey: ['collaborations', identity(user)], initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => apiRequest<{ items: Collaboration[]; nextCursor: number | null }>(`/api/collaborations${pageParam ? `?before=${pageParam}` : ''}`), getNextPageParam: page => page.nextCursor ?? undefined, refetchInterval: 10_000, refetchOnWindowFocus: true });
  const items = query.data?.pages.flatMap(page => page.items).filter(item => tab === 'received' ? item.ownerId === user?.artistId : item.applicantId === user?.artistId) ?? [];
  return <section className="max-w-4xl mx-auto p-6 space-y-6 pb-24"><Link className="underline text-sm" href="/profile">Back to profile</Link><h1 className="text-3xl font-bold">Collaborations</h1><p className="text-muted">Your proposals, private conversations and work in progress.</p>
    <div className="flex gap-3" aria-label="Collaboration views"><button className={tab === 'received' ? primary : button} aria-pressed={tab === 'received'} onClick={() => setTab('received')}>Received</button><button className={tab === 'sent' ? primary : button} aria-pressed={tab === 'sent'} onClick={() => setTab('sent')}>Sent</button></div>
    <ErrorMessage error={query.error} />{query.error && <button className={button} onClick={() => void query.refetch()}>Try again</button>}
    {query.isLoading ? <p role="status">Loading collaborations…</p> : !items.length && !query.error ? <p>No conversations in this view yet.{query.hasNextPage ? ' Load more to see earlier conversations.' : ''}</p> : items.map(item => <Link key={item.id} href={`/collaborations/${item.id}`} className="block border border-border p-5 space-y-2"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-bold text-xl">{item.projectTitle} · {item.terms.need}</h2><span className="text-accent text-sm">{statusText(item.status)}</span></div><p className="text-sm text-muted">with {tab === 'received' ? item.applicantName : item.ownerName}</p><p className="text-sm"><CompensationText value={item.terms.compensation} /></p></Link>)}
    {query.hasNextPage && <button className={button} disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more</button>}
  </section>;
}

export function CollaborationPage() { return <ArtistAccess><Workspace /></ArtistAccess>; }
function Workspace() {
  const { id } = useParams<{ id: string }>(), { user } = useAuth(), client = useQueryClient();
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [message, setMessage] = useState(''), [feedback, setFeedback] = useState('');
  const query = useQuery({ queryKey: ['collaboration', Number(id), identity(user)], queryFn: () => apiRequest<CollaborationDetail>(`/api/collaborations/${id}`), refetchInterval: 10_000, refetchOnWindowFocus: true });
  const [older, setOlder] = useState<CollaborationDetail['messages']>([]), [cursor, setCursor] = useState<number | null | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  useEffect(() => { setOlder([]); setCursor(undefined); setError(''); setMessage(''); }, [id, user?.artistId]);
  async function action(action: string, extra = {}) {
    if (!query.data || pending) return; setPending(true); setError('');
    try { await write(`/api/collaborations/${id}`, 'PATCH', { action, revision: query.data.revision, ...extra }); setFeedback(''); await refresh(client); }
    catch (error) { setError((error as Error).message); } finally { setPending(false); }
  }
  if (query.isLoading) return <p className="p-8" role="status">Loading collaboration…</p>;
  if (query.error || !query.data) return <div className="p-8"><ErrorMessage error={query.error ?? 'Collaboration not found.'} /><button className={button} onClick={() => void query.refetch()}>Try again</button></div>;
  const item = query.data, owner = user?.artistId === item.ownerId;
  const messages = [...new Map([...older, ...item.messages].map(m => [m.id, m])).values()].sort((a,b) => a.id-b.id);
  return <section className="max-w-5xl mx-auto p-6 pb-24 space-y-6"><Link className="underline text-sm" href="/collaborations">All collaborations</Link>
    <header className="space-y-3"><p className="voice text-xs text-accent">{statusText(item.status)}</p><h1 className="text-3xl font-bold">{item.projectTitle} · {item.terms.need}</h1><p>with {owner ? item.applicantName : item.ownerName}</p><p className="text-sm text-muted">Private workspace. Accepting work records your selection; payments and royalty distribution are not processed here.</p></header>
    <ErrorMessage error={error} />
    <div className="grid lg:grid-cols-2 gap-6 items-start"><div className="space-y-6">
      <section className="border border-border p-5 space-y-4"><h2 className="text-xl font-bold">{item.status === 'discussion' ? 'Offer at first contact' : 'Terms of this proposal'}</h2><Terms offer={item.terms} /><p className="text-xs text-muted">Offer version {item.terms.revision}</p></section>
      {owner && <section className="border border-border p-5 space-y-4" aria-label="Review work"><h2 className="text-xl font-bold">Review work</h2>
        {item.status === 'submitted' && <><p className="text-sm text-muted">Accepting selects this artist, closes the offer and declines its other pending proposals. Review the saved terms above.</p><button className={primary} disabled={pending || !item.currentOffer.available} onClick={() => void action('accept')}>Accept proposal</button></>}
        {['discussion','submitted','changes_requested'].includes(item.status) && <button className={`${button} ml-2`} disabled={pending} onClick={() => void action('reject')}>Decline proposal</button>}
        {['submitted','delivered'].includes(item.status) && <><label className="block space-y-2">Revision feedback<textarea className={field} rows={3} maxLength={4000} value={feedback} onChange={e => setFeedback(e.target.value)} /></label><button className={button} disabled={pending || !feedback.trim()} onClick={() => void action('request_changes', { feedback })}>Request changes</button></>}
        {item.status === 'delivered' && <button className={primary} disabled={pending} onClick={() => void action('complete')}>Mark completed</button>}
        {['accepted','completed','withdrawn','rejected'].includes(item.status) && <p className="text-sm text-muted">{item.status === 'accepted' ? 'Waiting for the artist’s delivery.' : `This collaboration is ${statusText(item.status)}.`}</p>}
      </section>}
      {!owner && ['discussion','changes_requested','accepted'].includes(item.status) && <SubmissionForm key={`${item.id}-${item.status}`} item={item} onDone={() => refresh(client)} />}
      {!owner && ['discussion','submitted','changes_requested'].includes(item.status) && <button className={button} disabled={pending} onClick={() => void action('withdraw')}>Withdraw proposal</button>}
      <section className="space-y-4"><h2 className="text-xl font-bold">Submitted work</h2>{!item.submissions.length && <p className="text-sm text-muted">No work submitted yet. You can discuss the brief first.</p>}{item.submissions.map(submission => <article key={submission.id} className="border border-border p-4 space-y-3"><p className="text-accent text-sm">{submission.kind} · {new Date(submission.createdAt).toLocaleString()}</p><p className="whitespace-pre-wrap break-words text-sm">{submission.text}</p>{submission.remix && <p className="text-sm text-accent">{submission.remix.title} · Remix of {submission.remix.originalTitle} by {submission.remix.originalArtist}</p>}{submission.terms && <details><summary className="text-sm underline cursor-pointer">Terms saved with this submission</summary><div className="mt-3"><Terms offer={submission.terms} /></div></details>}{(submission.files ?? [submission.media]).map(file => <WorkFile key={file.id} file={file} />)}</article>)}</section>
    </div>
    <section aria-label="Private conversation" className="border border-border p-5 space-y-4"><h2 className="text-xl font-bold">Conversation</h2><p className="text-xs text-muted">Only you and the other artist can read these messages, including after the work is completed.</p>
      {(cursor === undefined ? item.nextMessageCursor : cursor) && <button className={button} disabled={loadingOlder} onClick={async () => { setLoadingOlder(true); try { const page = await apiRequest<CollaborationDetail>(`/api/collaborations/${id}?before=${cursor ?? item.nextMessageCursor}`); setOlder(current => [...page.messages,...current]); setCursor(page.nextMessageCursor); } catch (error) { setError((error as Error).message); } finally { setLoadingOlder(false); } }}>Earlier messages</button>}
      <div className="space-y-4 max-h-[480px] overflow-y-auto" aria-label="Messages">{!messages.length && <p className="text-sm text-muted">Start with a question about the brief.</p>}{messages.map(m => <article key={m.id} className={`border-l-2 pl-3 ${m.authorId === user?.artistId ? 'border-accent' : 'border-border'}`}><p className="text-sm font-bold">{m.author}</p><p className="text-sm whitespace-pre-wrap break-words">{m.text}</p><time className="text-xs text-muted" dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString()}</time></article>)}</div>
      <form className="space-y-3" onSubmit={async e => { e.preventDefault(); if (pending || !message.trim()) return; setPending(true); setError(''); try { await write(`/api/collaborations/${id}/messages`, 'POST', { text: message }); setMessage(''); await refresh(client); } catch (error) { setError((error as Error).message); } finally { setPending(false); } }}><label className="block space-y-2">Message<textarea className={field} rows={3} maxLength={4000} value={message} onChange={e => setMessage(e.target.value)} /></label><button className={primary} disabled={pending || !message.trim()}>Send message</button></form>
    </section></div>
  </section>;
}

function SubmissionForm({ item, onDone }: { item: CollaborationDetail; onDone: () => Promise<void> }) {
  const { user } = useAuth();
  const search = useSearch();
  const selectedId = Number(new URLSearchParams(search).get('publication'));
  const savedRemix = usePublication(Number.isSafeInteger(selectedId) && selectedId > 0 ? selectedId : undefined);
  const usableRemix = savedRemix.data?.artistId === user?.artistId && savedRemix.data?.remix?.projectId === item.currentOffer.projectId ? savedRemix.data : null;
  const [publicationId, setPublicationId] = useState<number | null>(null);
  const delivery = item.status === 'accepted', [files, setFiles] = useState<UploadedMedia[]>([]), [description, setDescription] = useState(''), [ack, setAck] = useState(false);
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [uploading, setUploading] = useState(false), [progress, setProgress] = useState(0), [ready, setReady] = useState<Record<string, boolean>>({});
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { setAck(false); }, [item.currentOffer.revision]);
  return <form aria-label={delivery ? 'Delivery form' : 'Proposal form'} className="border border-accent p-5 space-y-4" onSubmit={async e => { e.preventDefault(); if (!files.length || pending || uploading) return; setPending(true); setError(''); try { await write(`/api/collaborations/${item.id}`, 'PATCH', { action: delivery ? 'deliver' : 'submit', revision: item.revision, offerRevision: item.currentOffer.revision, acceptTerms: ack, text: description, mediaId: files[0].id, mediaIds: files.map(file => file.id), publicationId }); await onDone(); } catch (error) { setError((error as Error).message); } finally { setPending(false); } }}>
    <h2 className="text-xl font-bold">{delivery ? 'Deliver your work' : 'Submit your proposal'}</h2>
    {!delivery && <><Terms offer={item.currentOffer} />{!item.currentOffer.available && <p role="status">This offer is no longer accepting proposals.</p>}</>}
    <label className="block space-y-2">{delivery ? 'Delivery notes' : 'Your proposal'}<textarea className={field} rows={4} required maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} /></label>
    {usableRemix && <div className="border border-border p-4 space-y-3"><p>Saved remix: {usableRemix.title}</p><p className="text-sm text-muted">Remix of {usableRemix.remix!.title} · {usableRemix.remix!.artistName}</p><button type="button" className={button} disabled={pending || uploading || publicationId === usableRemix.id} onClick={() => { const attached = [usableRemix.media, ...files.filter(file => file.id !== usableRemix.media.id)]; if (attached.length > 10 || attached.reduce((sum, file) => sum + file.size, 0) > 250 * 1024 * 1024) { setError('Remove a file before adding the remix: up to 10 files / 250 MB.'); return; } setFiles(attached); setPublicationId(usableRemix.id); setError(''); }}>Use saved remix</button>{publicationId && <p className="text-sm text-accent">Remix selected. Review the terms and send your proposal.</p>}</div>}
    {savedRemix.error && <ErrorMessage error={savedRemix.error} />}
    <label className="block space-y-2">Work files (audio, video, PDF or ZIP)<input className={`${field} min-w-0`} type="file" multiple accept="audio/*,video/*,.pdf,.zip" disabled={pending || uploading} onChange={async e => {
      const selected = Array.from(e.target.files ?? []); e.target.value = ''; if (!selected.length) return; setError('');
      if (files.length + selected.length > 10) { setError('Attach up to 10 files. Remove a file before adding more.'); return; }
      if (selected.some(file => file.size > (/\.pdf$/i.test(file.name) ? 20 : 100) * 1024 * 1024)) { setError('Each file can be up to 100 MB; PDFs up to 20 MB.'); return; }
      if ([...files, ...selected].reduce((sum, file) => sum + file.size, 0) > 250 * 1024 * 1024) { setError('A submission can contain up to 250 MB.'); return; }
      setUploading(true); setProgress(0); const abort = new AbortController(); controller.current = abort;
      try {
        for (let index = 0; index < selected.length; index++) {
          const file = selected[index], kind = /\.pdf$/i.test(file.name) ? 'document' : /\.zip$/i.test(file.name) ? 'archive' : file.type.startsWith('video/') ? 'video' : 'audio';
          const uploaded = await uploadMedia(file, kind, value => setProgress(Math.round((index * 100 + value) / selected.length)), abort.signal);
          if (abort.signal.aborted) break;
          setFiles(current => [...current, uploaded]);
        }
      } catch (error) { setError((error as Error).message); } finally { setUploading(false); }
    }} /></label>
    <p className="text-xs text-muted">Up to 10 files / 250 MB per submission. Audio, video and ZIP: 100 MB each. PDF: 20 MB. ZIP archives are downloaded without extraction.</p>
    {uploading && <div><p role="status">Uploading {progress}%</p><button type="button" className={button} onClick={() => controller.current?.abort()}>Cancel upload</button></div>}
    {files.map((file, index) => <div key={file.id} className="border border-border p-3 space-y-2"><WorkFile file={file} onReady={value => setReady(current => current[file.id] === value ? current : { ...current, [file.id]: value })} /><button type="button" className="text-sm underline" disabled={pending || uploading} aria-label={`Remove ${file.name ?? file.kind}`} onClick={() => { setFiles(current => current.filter(item => item.id !== file.id)); if (index === 0) setPublicationId(null); }}>Remove file</button></div>)}
    {!delivery && <label className="flex gap-3 items-start text-sm"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />I reviewed the current deliverable, compensation and terms.</label>}
    <p className="text-xs text-muted">Uploaded work is shared with the project owner when submitted. Unsubmitted uploads can be removed in Your publications. No payment or royalty transfer occurs.</p>
    <ErrorMessage error={error} /><button className={primary} disabled={pending || uploading || !files.length || files.some(file => ['audio','video'].includes(file.kind) && !ready[file.id]) || !description.trim() || (!delivery && (!ack || !item.currentOffer.available))}>{pending ? 'Submitting…' : delivery ? 'Send delivery' : 'Send proposal'}</button>
  </form>;
}

function WorkFile({ file, onReady }: { file: UploadedMedia; onReady?: (ready: boolean) => void }) {
  const [failed, setFailed] = useState(false);
  const events = { onLoadedData: () => { setFailed(false); onReady?.(true); }, onError: () => { setFailed(true); onReady?.(false); } };
  return <div className="space-y-2 min-w-0"><p className="text-sm break-words">{file.name ?? `${file.kind} file`} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>
    {file.kind === 'video' ? <video src={file.url} controls playsInline preload={onReady ? 'auto' : 'metadata'} className="max-h-80 w-full" {...events} /> : file.kind === 'audio' ? <audio src={file.url} controls preload={onReady ? 'auto' : 'metadata'} className="w-full" {...events} /> : null}
    {failed && <p role="alert" className="text-danger text-sm">This file cannot be played. Use MP3/WAV or MP4/WebM, or attach unsupported stems in a ZIP.</p>}
    <a className="underline text-sm break-words" href={`${file.url}?download=1`} download={file.name}>Download {file.name ?? 'file'}</a>
  </div>;
}
