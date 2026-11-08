import { songProjectHref } from '@nebula/local';
import { SongSelector } from '@/features/songs';
import { useLeaveGuard } from '@/components/shell/navigation-guard';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams, useSearch } from 'wouter';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, isServerMode, type CollaborationOffer, type OfferInput, type Compensation, type Collaboration, type CollaborationDetail, type UploadedMedia } from '@nebula/local';
import { useAuth } from '@/context/AuthContext';
import { uploadMedia } from '@/features/discovery/publication-api';
import { useRemixDraft } from '@/features/remix/draft-api';
import { usePublication } from '@/features/discovery/publication-api';
import { formatMoney } from '@/lib/utils';
import { controlStyles, Panel, ReturnLink, StateBadge } from '@/components/antiq/workspace';
import { useWorkspaceDraft } from './drafts';
import { ArtistMessagesAccess, Transcript, ViewedActivity, useMessageOperation, refreshMessages } from '@/features/messages/shared';

const { field, button, primary } = controlStyles;
const statusText = (value: string) => value.replaceAll('_', ' ');
const identity = (user: ReturnType<typeof useAuth>['user']) => user ? `${user.role}:${user.artistId ?? user.investorId}` : 'guest';
async function write<T>(path: string, method: string, data: object): Promise<T> { return apiRequest<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); }
async function refresh(client: ReturnType<typeof useQueryClient>) { await Promise.all(['offers','collaborations','collaboration','publication','discovery-feed','opportunity-projects','messages','notification-summary'].map(key => client.invalidateQueries({ queryKey: [key] }))); }
function ErrorMessage({ error }: { error: unknown }) { return error ? <p role="alert" className="text-sm text-danger">{error instanceof Error ? error.message : String(error)}</p> : null; }
export function CompensationText({ value }: { value: Compensation }) { return <>{value.kind === 'split' ? `${value.percent}% royalty split offered` : `${formatMoney(value.amount)} fixed fee`}</>; }
function Terms({ offer }: { offer: CollaborationOffer }) {
  return <div className="space-y-3 text-sm"><p className="text-muted">{offer.workId ? `For: ${offer.workTitle ?? "Song unavailable"}` : "Project-wide"}</p><p className="text-accent"><CompensationText value={offer.compensation} /></p><p className="whitespace-pre-wrap break-words"><strong>Deliverable: </strong>{offer.deliverable}</p>{offer.requirements && <p className="whitespace-pre-wrap break-words"><strong>Requirements & terms: </strong>{offer.requirements}</p>}<p className="text-muted">{offer.deadline ? `Apply by ${offer.deadline} (UTC)` : 'No application deadline'}</p></div>;
}

function nextStep(item: CollaborationDetail, owner: boolean) {
  if (item.requestPolicy === 1 && item.admission !== 'accepted') return item.admission === 'pending' ? 'Review the proposal and files here. Messages open after acceptance; requested revisions stay in this thread.' : 'This request is closed. Its proposal, files and history remain available; messages are disabled.';
  if (item.status === 'completed') return 'Work completed. Your files, agreed terms and private conversation remain available.';
  if (item.status === 'withdrawn' || item.status === 'rejected') return 'This application is closed. You can still message each other and review the submitted files.';
  if (item.status === 'discussion') return owner ? 'Discuss the brief with the artist while they prepare a proposal.' : item.currentOffer.available ? 'Ask a question or send your proposal with work files and reviewed terms.' : 'This offer is not accepting proposals. You can still discuss it with the project owner.';
  if (item.status === 'submitted') return owner ? item.currentOffer.available ? 'Review the submitted work, then accept it, request changes or decline the proposal.' : 'This offer is unavailable. You can request changes, decline or discuss the next step.' : 'Your proposal is with the project owner. You can keep discussing the work while they review it.';
  if (item.status === 'changes_requested') return owner ? 'Your feedback was sent. Wait for the artist’s revised proposal or continue the conversation.' : 'Read the requested changes in the conversation, then send a revised proposal.';
  if (item.status === 'accepted') return owner ? 'The proposal is accepted. Wait for the artist’s delivery.' : 'Your proposal is accepted. Upload your final files and send your delivery under the agreed terms.';
  return owner ? 'Review the delivery, then request changes or mark the collaboration completed.' : 'Your delivery is ready for review. The project owner can complete it or request changes.';
}

export function ProjectOffers({ projectId, ownerId, compact = false, proposalPublicationId, proposalDraftId, scopeWorkId }: { scopeWorkId?: number | null; projectId: number; ownerId?: number; compact?: boolean; proposalPublicationId?: number; proposalDraftId?: string }) {
  const { user } = useAuth(), client = useQueryClient(), [, navigate] = useLocation();
  const [editing, setEditing] = useState<CollaborationOffer | 'new' | null>(null), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const query = useQuery({ queryKey: ['offers', projectId, identity(user)], queryFn: () => apiRequest<CollaborationOffer[]>(`/api/projects/${projectId}/offers`), enabled: isServerMode(), refetchInterval: 15_000, refetchOnWindowFocus: true });
  if (!isServerMode()) return null;
  const mine = user?.artistId === ownerId;
  async function openConversation(offer: CollaborationOffer) {
    navigate(`/messages/offer/${offer.id}${proposalDraftId ? `?draft=${encodeURIComponent(proposalDraftId)}` : proposalPublicationId ? `?publication=${proposalPublicationId}` : ''}`);
  }
  return <section aria-label="Collaboration offers" className="space-y-5 border-t border-border pt-6">
    <div className="flex flex-wrap justify-between gap-3"><div><p className="voice text-xs text-accent">COLLABORATIONS</p><h2 className="text-2xl font-bold">Make it together.</h2></div>{mine && !compact && <button className={button} onClick={() => setEditing('new')}>New offer</button>}</div>
    <p className="text-sm text-muted">One offer per need. Remix permission is separate; a remix does not grant a collaboration or royalties.</p>
    {mine && compact && <Link href={`/project/${projectId}`} className="underline text-sm">Manage collaboration offers</Link>}
    <ErrorMessage error={error || query.error} />{query.error && <button className={button} onClick={() => void query.refetch()}>Retry offers</button>}
    {query.isLoading && <p role="status">Loading offers…</p>}
    {editing && <OfferEditor key={editing === 'new' ? 'new' : `${editing.id}-${editing.revision}`} projectId={projectId} initialWorkId={scopeWorkId} existing={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    {!query.isLoading && !query.error && !query.data?.filter(offer=>scopeWorkId===undefined||(offer.workId??null)===scopeWorkId).length && <p className="text-sm text-muted">{mine ? 'Create an offer to invite another artist into this project.' : 'No open collaboration offers.'}</p>}
    {query.data?.filter(offer => scopeWorkId === undefined || (offer.workId??null)===scopeWorkId).map(offer => <article key={offer.id} aria-label={`${offer.need} offer`} className="min-w-0 rounded-surface border border-border bg-surface p-5 sm:p-6 space-y-4">
      <div className="flex justify-between gap-3"><h3 className="text-xl font-semibold">{offer.need}</h3><span className="text-xs text-muted">{offer.available ? 'open call' : offer.status === 'closed' ? 'closed' : 'not accepting applications'}</span></div>
      <Terms offer={offer} />
      {mine ? !compact && <div className="flex flex-wrap gap-2"><button className={button} onClick={() => setEditing(offer)}>Edit offer</button>{offer.status === 'open' && <button className={button} disabled={pending} onClick={async () => { setPending(true); setError(''); try { await write(`/api/offers/${offer.id}`, 'PATCH', { revision: offer.revision, action: 'close' }); await refresh(client); } catch (error) { setError((error as Error).message); } finally { setPending(false); } }}>Close offer</button>}<Link href="/collaborations" className={button}>Review proposals</Link></div>
        : user?.role === 'artist' ? <div className="flex flex-wrap gap-2"><button className={button} disabled={pending || !offer.available} onClick={() => void openConversation(offer)}>Contact artist</button><button className={primary} disabled={pending || !offer.available} onClick={() => void openConversation(offer)}>Submit proposal</button></div>
        : user ? <p className="text-sm text-muted">An artist account is required to apply.</p> : <div className="flex gap-4 text-sm underline"><Link href="/login">Log in to collaborate</Link><Link href="/register">Create artist account</Link></div>}
    </article>)}
  </section>;
}

function OfferEditor({ projectId, existing, onClose, initialWorkId }: { initialWorkId?: number | null; projectId: number; existing?: CollaborationOffer; onClose: () => void }) {
  const client = useQueryClient();
  const [value, setValue, discard] = useWorkspaceDraft<OfferInput>(`offer-${projectId}-${existing?.id ?? `new-${initialWorkId??'general'}`}`, existing ?? { workId:initialWorkId??null, need: 'Verse', deliverable: '', requirements: '', deadline: null, status: 'open', compensation: { kind: 'split', percent: 10 } });
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const saving = useRef(false);
  const savedRevision = (value as Partial<CollaborationOffer>).revision;
  const staleEdit = !!existing && savedRevision !== undefined && savedRevision !== existing.revision;
  return <form aria-label="Offer editor" className="min-w-0 rounded-surface border border-border bg-surface p-5 sm:p-6 space-y-4" onSubmit={async event => {
    event.preventDefault(); if (saving.current || staleEdit) return; saving.current = true; setPending(true); setError('');
    try { await write(existing ? `/api/offers/${existing.id}` : `/api/projects/${projectId}/offers`, existing ? 'PATCH' : 'POST', { ...value, revision: existing?.revision }); await refresh(client); discard(); onClose(); } catch (error) { setError((error as Error).message); } finally { saving.current = false; setPending(false); }
  }}>
    <fieldset disabled={pending} className="min-w-0 space-y-4"><h3 className="text-lg font-bold">{existing ? 'Edit collaboration offer' : 'New collaboration offer'}</h3>
    {staleEdit && <Panel aria-label="Updated offer"><p className="text-sm">This offer changed while your edit was saved. Compare the current terms before keeping your edits.</p><Terms offer={existing!} /><div className="flex flex-wrap gap-3"><button type="button" className={button} onClick={() => setValue({ ...value, revision: existing!.revision } as CollaborationOffer)}>Keep my edits with this version</button><button type="button" className={button} onClick={() => setValue(existing!)}>Use current offer</button></div></Panel>}
    <SongSelector projectId={projectId} value={value.workId} onChange={workId=>setValue({...value,workId})}/><label className="block space-y-2">Looking for<select className={field} value={value.need} onChange={e => setValue({ ...value, need: e.target.value as OfferInput['need'] })}>{['Verse','Feature','Production','Mix','Master'].map(need => <option key={need}>{need}</option>)}</select></label>
    <label className="block space-y-2">Expected deliverable<textarea className={field} required maxLength={2000} rows={3} value={value.deliverable} onChange={e => setValue({ ...value, deliverable: e.target.value })} /></label>
    <label className="block space-y-2">Requirements and terms<textarea className={field} maxLength={4000} rows={4} placeholder="Style, language, file format, revisions, credit and payment or royalty conditions." value={value.requirements} onChange={e => setValue({ ...value, requirements: e.target.value })} /></label>
    <div className="grid sm:grid-cols-2 gap-4"><label className="block space-y-2">Compensation<select className={field} value={value.compensation.kind} onChange={e => setValue({ ...value, compensation: e.target.value === 'split' ? { kind: 'split', percent: 10 } : { kind: 'fee', amount: 100, currency: 'USD' } })}><option value="split">Royalty split</option><option value="fee">Fixed fee (USD)</option></select></label>
    <label className="block space-y-2">{value.compensation.kind === 'split' ? 'Royalty percentage' : 'Fee in USD'}<input className={field} required type="number" min="0.01" max={value.compensation.kind === 'split' ? 100 : 1000000} step="0.01" value={value.compensation.kind === 'split' ? value.compensation.percent : value.compensation.amount} onChange={e => setValue({ ...value, compensation: value.compensation.kind === 'split' ? { kind: 'split', percent: Number(e.target.value) } : { kind: 'fee', amount: Number(e.target.value), currency: 'USD' } })} /></label></div>
    <label className="block space-y-2">Application deadline (optional, UTC)<input className={field} type="date" min={new Date().toISOString().slice(0,10)} value={value.deadline ?? ''} onChange={e => setValue({ ...value, deadline: e.target.value || null })} /></label>
    <label className="block space-y-2">Offer status<select className={field} value={value.status} onChange={e => setValue({ ...value, status: e.target.value as OfferInput['status'] })}><option value="open">Open — looking for collaborators</option><option value="closed">Closed</option></select></label>
    <p className="text-sm text-muted">Publish the project to make open offers visible. Submitted proposals keep the terms they were sent under. Fees and splits are offers; this platform does not collect payments or distribute royalties.</p>
    <ErrorMessage error={error} /><div className="flex flex-wrap gap-3"><button className={primary} disabled={pending || staleEdit}>{pending ? 'Saving…' : 'Save offer'}</button><button type="button" className={button} disabled={pending} onClick={onClose}>Cancel</button></div></fieldset>
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
  const { user } = useAuth(); const [tab, setTab] = useWorkspaceDraft<'received' | 'sent'>('list-view', 'received');
  const [scroll, setScroll] = useWorkspaceDraft('list-scroll-position', { window: 0, body: 0, shell: 0 }); const restored = useRef(false);
  const query = useInfiniteQuery({ queryKey: ['collaborations', identity(user)], initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => apiRequest<{ items: Collaboration[]; nextCursor: number | null }>(`/api/collaborations${pageParam ? `?before=${pageParam}` : ''}`), getNextPageParam: page => page.nextCursor ?? undefined, refetchInterval: 10_000, refetchOnWindowFocus: true });
  useEffect(() => { if (query.data && !restored.current) { restored.current = true; requestAnimationFrame(() => { window.scrollTo(0, scroll.window); document.body.scrollTop = scroll.body; const shell = document.querySelector('.shell-page'); if (shell) shell.scrollTop = scroll.shell; }); } }, [query.data, scroll]);
  const items = query.data?.pages.flatMap(page => page.items).filter(item => tab === 'received' ? item.ownerId === user?.artistId : item.applicantId === user?.artistId) ?? [];
  return <section className="w-full max-w-5xl mx-auto px-4 py-6 sm:p-8 space-y-6"><ReturnLink href="/profile">Back to profile</ReturnLink><h1 className="text-3xl font-bold">Collaborations</h1><p className="text-muted">Your proposals, private conversations and work in progress.</p>
    <div className="flex flex-wrap gap-3" aria-label="Collaboration views"><button className={tab === 'received' ? primary : button} aria-pressed={tab === 'received'} onClick={() => setTab('received')}>Received</button><button className={tab === 'sent' ? primary : button} aria-pressed={tab === 'sent'} onClick={() => setTab('sent')}>Sent</button></div>
    <ErrorMessage error={query.error} />{query.error && <button className={button} onClick={() => void query.refetch()}>Try again</button>}
    {query.isLoading ? <p role="status">Loading collaborations…</p> : !items.length && !query.error ? <Panel><h2 className="font-semibold">{tab === 'received' ? 'No proposals received yet' : 'No proposals sent yet'}</h2><p className="text-sm text-muted">{tab === 'received' ? 'Create an offer on a project to invite another artist.' : 'Find a project with an open offer to start a conversation.'}{query.hasNextPage ? ' Load more to see earlier conversations.' : ''}</p><Link className={button} href={tab === 'received' ? '/profile' : '/explore'}>{tab === 'received' ? 'Your projects' : 'Find a project'}</Link></Panel> : items.map(item => <Link key={item.id} href={`/collaborations/${item.id}`} onClick={() => setScroll({ window: window.scrollY, body: document.body.scrollTop, shell: document.querySelector('.shell-page')?.scrollTop ?? 0 })} className="block min-w-0 rounded-surface border border-border bg-surface p-5 sm:p-6 space-y-3 transition-colors hover:border-accent/50"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold text-xl break-words min-w-0">{item.projectTitle}{item.terms.workId ? ` → ${item.terms.workTitle ?? "Song"}` : ""} · {item.terms.need}</h2><StateBadge>{statusText(item.status)}</StateBadge></div><p className="text-sm text-muted">with {tab === 'received' ? item.applicantName : item.ownerName}</p><p className="text-sm"><CompensationText value={item.terms.compensation} /></p></Link>)}
    {query.hasNextPage && <button className={button} disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more</button>}
  </section>;
}

export function CollaborationPage() { const { id } = useParams<{ id: string }>(); const { user } = useAuth(); return <ArtistAccess><Workspace key={`${user?.artistId}:${id}`} /></ArtistAccess>; }
function Workspace() {
  const operation = useMessageOperation("collaboration-work");
  const { id } = useParams<{ id: string }>(), { user } = useAuth(), client = useQueryClient();
  const [error, setError] = useState(''), [pending, setPending] = useState(false);
  const [message, setMessage] = useWorkspaceDraft(`thread-${id}-message`, '');
  const [decline, setDecline] = useWorkspaceDraft(`thread-${id}-decline`, '');
  const [feedback, setFeedback] = useWorkspaceDraft(`thread-${id}-feedback`, '');
  const [, setListView] = useWorkspaceDraft<'received' | 'sent'>('list-view', 'received');
  const writing = useRef(false);
  const query = useQuery({ queryKey: ['collaboration', Number(id), identity(user)], queryFn: ({signal}) => apiRequest<CollaborationDetail>(`/api/collaborations/${id}`, {signal}), refetchInterval: 10_000, refetchOnWindowFocus: true });
  const [older, setOlder] = useState<CollaborationDetail['messages']>([]), [cursor, setCursor] = useState<number | null | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  useEffect(() => { setOlder([]); setCursor(undefined); setError(''); }, [id, user?.artistId]);
  async function action(action: string, extra = {}) {
    if (!query.data || writing.current) return;
    const consequence = action === 'reject' ? 'Decline this proposal? This closes the application. Submitted files and the conversation remain available to both artists.' : action === 'withdraw' ? 'Withdraw this proposal? You will not be able to submit more work to this application. The conversation and submitted files remain available.' : null;
    if (consequence && !window.confirm(consequence)) return;
    writing.current = true; setPending(true); setError('');
    try { await operation(`/api/collaborations/${id}`, 'PATCH', { action, revision: query.data.revision, ...(action === 'accept' ? {submissionId:query.data.submissions.find(s=>s.kind==='proposal')?.id,offerRevision:query.data.currentOffer.revision}:{}), ...(action === 'reject' ? {response:decline}:{}), ...extra }); setDecline(''); setFeedback(''); await refresh(client); }
    catch (error) { setError((error as Error).message); if ((error as { status?: number }).status === 409) await query.refetch(); } finally { writing.current = false; setPending(false); }
  }
  if (query.isLoading) return <p className="p-8" role="status">Loading collaboration…</p>;
  if (!query.data || [401,403,404].includes((query.error as { status?: number } | null)?.status ?? 0)) return <div className="p-8 space-y-4"><ReturnLink href="/messages">All messages</ReturnLink><ErrorMessage error={query.error ?? 'Collaboration not found.'} /><button className={button} onClick={() => void query.refetch()}>Try again</button></div>;
  const item = query.data, owner = user?.artistId === item.ownerId;
  const staleProposal = item.requestPolicy === 1 && item.terms.revision !== item.currentOffer.revision;
  const messages = [...new Map([...older, ...item.messages].map(m => [m.id, m])).values()].sort((a,b) => a.id-b.id);
  return <section className="w-full max-w-6xl mx-auto px-4 py-6 sm:p-8 space-y-6"><ReturnLink href="/messages" onClick={() => setListView(owner ? 'received' : 'sent')}>All messages</ReturnLink>
    <header className="space-y-3"><div className="flex flex-wrap items-center gap-3"><StateBadge>{statusText(item.status)}</StateBadge><p className="voice text-xs text-muted">{owner ? 'Project owner' : 'Collaborating artist'}</p></div><h1 className="text-2xl sm:text-3xl font-semibold break-words">{item.projectTitle}{item.terms.workId ? ` → ${item.terms.workTitle ?? "Song"}` : ""} · {item.terms.need}</h1><p>with <Link className="underline" href={`/artist/${owner ? item.applicantId : item.ownerId}`}>{owner ? item.applicantName : item.ownerName}</Link></p><p className="text-sm text-muted">Private workspace. Accepting work records your selection; payments and royalty distribution are not processed here.</p></header>
    <Panel aria-label="Next step"><h2 className="text-sm font-semibold">Next step</h2><p className="text-sm text-muted">{nextStep(item, owner)}</p><Link className={button} href={songProjectHref(item.currentOffer.projectId,item.terms.workId)}>View project</Link></Panel>
    <ErrorMessage error={error} />
    {query.error && <Panel><ErrorMessage error={query.error} /><p className="text-sm text-muted">Showing the last loaded conversation. Your unfinished work is kept.</p><button className={button} onClick={() => void query.refetch()}>Retry collaboration</button></Panel>}
    <div className="grid xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-6 items-start"><div className="min-w-0 space-y-6">
      <Panel><h2 className="text-xl font-bold">{item.status === 'discussion' ? 'Offer at first contact' : 'Terms of this proposal'}</h2><Terms offer={item.terms} /><p className="text-xs text-muted">Offer version {item.terms.revision}</p></Panel>
      {owner && <Panel aria-label="Review work" className="[&>button]:mr-2"><h2 className="text-xl font-bold">Review work</h2>
        {item.status === 'submitted' && <><p className="text-sm">Proposal #{item.submissions.find(s=>s.kind==='proposal')?.id} · terms version {item.terms.revision}</p>{staleProposal && <p role="status" className="text-sm text-accent">The offer terms changed. Request a revised proposal before accepting.</p>}<p className="text-sm text-muted">Accepting selects this artist, closes the offer and declines its other pending proposals. Review the saved terms above.</p><button className={primary} disabled={pending || !item.currentOffer.available || staleProposal} onClick={() => void action('accept')}>Accept proposal</button></>}
        {['discussion','submitted','changes_requested'].includes(item.status) && <><label className="block space-y-2">Decline response (optional)<textarea className={field} value={decline} onChange={e=>setDecline(e.target.value)} maxLength={4000} disabled={pending}/></label><button className={button} disabled={pending} onClick={() => void action('reject')}>Decline proposal</button></>}
        {['submitted','delivered'].includes(item.status) && <><label className="block space-y-2">Revision feedback<textarea disabled={pending} className={field} rows={3} maxLength={4000} value={feedback} onChange={e => setFeedback(e.target.value)} /></label><button className={button} disabled={pending || !feedback.trim()} onClick={() => void action('request_changes', { feedback })}>Request changes</button></>}
        {item.status === 'delivered' && <button className={primary} disabled={pending} onClick={() => void action('complete')}>Mark completed</button>}
        {['accepted','completed','withdrawn','rejected'].includes(item.status) && <p className="text-sm text-muted">{item.status === 'accepted' ? 'Waiting for the artist’s delivery.' : `This collaboration is ${statusText(item.status)}.`}</p>}
      </Panel>}
      {!owner && ['discussion','changes_requested','accepted'].includes(item.status) && <SubmissionForm key={`${item.id}-${item.status === 'accepted' ? 'delivery' : 'proposal'}`} item={item} onDone={() => refresh(client)} />}
      {!owner && ['discussion','submitted','changes_requested'].includes(item.status) && <button className={button} disabled={pending} onClick={() => void action('withdraw')}>Withdraw proposal</button>}
      <section className="space-y-4"><h2 className="text-xl font-bold">Submitted work</h2>{!item.submissions.length && <p className="text-sm text-muted">No work submitted yet. You can discuss the brief first.</p>}{item.submissions.map(submission => <article key={submission.id} className="min-w-0 rounded-surface border border-border bg-surface p-4 space-y-3"><p className="text-accent text-sm">{submission.kind} · {new Date(submission.createdAt).toLocaleString()}</p><p className="whitespace-pre-wrap break-words text-sm">{submission.text}</p>{submission.remix && <p className="text-sm text-accent">{submission.remix.title} · Remix of {submission.remix.originalTitle} by {submission.remix.originalArtist}</p>}{submission.terms && <details><summary className="min-h-11 flex items-center text-sm underline cursor-pointer">Terms saved with this submission</summary><div className="mt-3"><Terms offer={submission.terms} /></div></details>}{(submission.files ?? [submission.media]).map(file => <WorkFile key={file.id} file={file} />)}</article>)}</section>
    </div>
    <Transcript messages={messages.map(m=>({...m,kind:m.kind??"message"}))} artistId={user!.artistId!}>
      {(cursor === undefined ? item.nextMessageCursor : cursor) && <button className={button} disabled={loadingOlder} onClick={async () => { setLoadingOlder(true); try { const page = await apiRequest<CollaborationDetail>(`/api/collaborations/${id}?before=${cursor ?? item.nextMessageCursor}`); setOlder(current => [...page.messages,...current]); setCursor(page.nextMessageCursor); } catch (error) { setError((error as Error).message); } finally { setLoadingOlder(false); } }}>Earlier messages</button>}
      {(item.requestPolicy !== 1 || item.admission === "accepted") ? <form className="space-y-3" onSubmit={async e => { e.preventDefault(); if (writing.current || !message.trim()) return; writing.current = true; setPending(true); setError(''); try { await operation(`/api/collaborations/${id}/messages`, 'POST', { text: message }); setMessage(''); await refresh(client); } catch (error) { setError((error as Error).message); } finally { writing.current = false; setPending(false); } }}><label className="block space-y-2">Message<textarea disabled={pending} className={field} rows={3} maxLength={4000} value={message} onChange={e => setMessage(e.target.value)} /></label><button className={primary} disabled={pending || !message.trim()}>Send message</button></form>
      : <p role="status" className="text-sm text-muted">{item.admission === "pending" ? "Waiting for acceptance. Messages are not enabled." : "This request is closed. Messages are disabled."}</p>}
      <ViewedActivity kind="collaboration" id={item.id} throughId={item.lastActivityId} unread={item.unreadCount}/>
    </Transcript></div>
  </section>;
}

type SubmissionContext = Pick<CollaborationDetail,'id'|'currentOffer'|'status'|'revision'>;
function SubmissionForm({ item, onDone, compose = false }: { item: SubmissionContext; onDone: (result?: Collaboration) => Promise<void>; compose?: boolean }) {
  const operation = useMessageOperation(`proposal-${compose ? 'offer' : 'thread'}-${item.id}`);
  const [introduction,setIntroduction] = useWorkspaceDraft(`offer-${item.id}-intro`, '');
  const { user } = useAuth();
  const search = useSearch();
  const selectedId = Number(new URLSearchParams(search).get('publication'));
  const savedRemix = usePublication(Number.isSafeInteger(selectedId) && selectedId > 0 ? selectedId : undefined);
  const privateRemix = useRemixDraft(new URLSearchParams(search).get('draft'));
  const privateValue = privateRemix.data && privateRemix.data.ownerId === user?.artistId && privateRemix.data.attribution.projectId === item.currentOffer.projectId && privateRemix.data.render ? { id: privateRemix.data.id, title: privateRemix.data.title, remix: privateRemix.data.attribution, media: privateRemix.data.render } : null;
  const usableRemix = privateValue ?? (savedRemix.data?.artistId === user?.artistId && savedRemix.data?.remix?.projectId === item.currentOffer.projectId ? savedRemix.data : null);
  const delivery = item.status === 'accepted';
  const draftKey = `${compose ? 'offer' : 'thread'}-${item.id}-${delivery ? 'delivery' : 'proposal'}`;
  const [publicationId, setPublicationId] = useWorkspaceDraft<number | null>(`${draftKey}-publication`, null), [remixDraftId, setRemixDraftId] = useWorkspaceDraft<string | null>(`${draftKey}-remix`, null);
  const [files, setFiles] = useWorkspaceDraft<UploadedMedia[]>(`${draftKey}-files`, []), [description, setDescription] = useWorkspaceDraft(`${draftKey}-text`, ''), [ack, setAck] = useState(false);
  const [interrupted, setInterrupted] = useWorkspaceDraft(`${draftKey}-interrupted`, false);
  const submitting = useRef(false);
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [uploading, setUploading] = useState(false), [progress, setProgress] = useState(0), [ready, setReady] = useState<Record<string, boolean>>({});
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const allowRedirect = useLeaveGuard(uploading || pending ? 'Work is still being sent. Stay to finish, or leave and check its status before trying again. Completed uploads and your text are kept in this tab.' : null);
  useEffect(() => { setAck(false); }, [item.currentOffer.revision]);
  return <form aria-label={delivery ? 'Delivery form' : 'Proposal form'} className="min-w-0 rounded-surface border border-border bg-surface p-5 sm:p-6 space-y-4" onSubmit={async e => { e.preventDefault(); if (!files.length || submitting.current || uploading) return; submitting.current = true; setPending(true); setError(''); try { const result = await operation<Collaboration>(compose ? `/api/offers/${item.id}/conversations` : `/api/collaborations/${item.id}`, compose ? 'POST' : 'PATCH', { ...(compose ? {introduction} : {}), action: delivery ? 'deliver' : 'submit', revision: item.revision, offerRevision: item.currentOffer.revision, acceptTerms: ack, text: description, mediaId: files[0].id, mediaIds: files.map(file => file.id), publicationId, remixDraftId }); setFiles([]); setDescription(''); setPublicationId(null); setRemixDraftId(null); setInterrupted(false); setIntroduction(''); setPending(false); allowRedirect(); await onDone(result); } catch (error) { setError((error as Error).message); if ((error as { status?: number }).status === 409) { setAck(false); await onDone(); } } finally { submitting.current = false; setPending(false); } }}>
    <h2 className="text-xl font-semibold">{delivery ? 'Deliver your work' : 'Submit your proposal'}</h2><p className="text-xs text-muted">Unsent text and completed uploads stay in this tab until you send them or log out.</p>{interrupted && !uploading && <p role="status" className="text-sm text-muted">The last upload did not finish. Completed files are kept below; select any missing files again.</p>}
    {!delivery && <><Terms offer={item.currentOffer} />{!item.currentOffer.available && <p role="status">This offer is no longer accepting proposals.</p>}</>}
    {compose && <label className="block space-y-2">Introduction<textarea className={field} required maxLength={4000} rows={3} value={introduction} disabled={pending} onChange={e=>setIntroduction(e.target.value)}/></label>}
    <label className="block space-y-2">{delivery ? 'Delivery notes' : 'Your proposal'}<textarea disabled={pending} className={field} rows={4} required maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} /></label>
    {usableRemix && <div className="min-w-0 rounded-surface border border-border bg-surface p-4 space-y-3"><p>Saved remix: {usableRemix.title}</p><p className="text-sm text-muted">Remix of {usableRemix.remix!.title} · {usableRemix.remix!.artistName}</p><button type="button" className={button} disabled={pending || uploading || (publicationId ?? remixDraftId) === usableRemix.id} onClick={() => { const attached = [usableRemix.media, ...files.filter(file => file.id !== usableRemix.media.id)]; if (attached.length > 10 || attached.reduce((sum, file) => sum + file.size, 0) > 250 * 1024 * 1024) { setError('Remove a file before adding the remix: up to 10 files / 250 MB.'); return; } setFiles(attached); setPublicationId(typeof usableRemix.id === 'number' ? usableRemix.id : null); setRemixDraftId(typeof usableRemix.id === 'string' ? usableRemix.id : null); setError(''); }}>Use saved remix</button>{(publicationId || remixDraftId) && <p className="text-sm text-accent">Remix selected. Review the terms and send your proposal.</p>}</div>}
    {(savedRemix.error || privateRemix.error) && <ErrorMessage error={savedRemix.error || privateRemix.error} />}
    <label className="block space-y-2">Work files (audio, video, PDF or ZIP)<input className={`${field} min-w-0`} type="file" multiple accept="audio/*,video/*,.pdf,.zip" disabled={pending || uploading} onChange={async e => {
      const selected = Array.from(e.target.files ?? []); e.target.value = ''; if (!selected.length) return; setError('');
      if (files.length + selected.length > 10) { setError('Attach up to 10 files. Remove a file before adding more.'); return; }
      if (selected.some(file => file.size > (/\.pdf$/i.test(file.name) ? 20 : 100) * 1024 * 1024)) { setError('Each file can be up to 100 MB; PDFs up to 20 MB.'); return; }
      if ([...files, ...selected].reduce((sum, file) => sum + file.size, 0) > 250 * 1024 * 1024) { setError('A submission can contain up to 250 MB.'); return; }
      setUploading(true); setInterrupted(true); setProgress(0); const abort = new AbortController(); controller.current = abort;
      try {
        for (let index = 0; index < selected.length; index++) {
          const file = selected[index], kind = /\.pdf$/i.test(file.name) ? 'document' : /\.zip$/i.test(file.name) ? 'archive' : file.type.startsWith('video/') ? 'video' : 'audio';
          const uploaded = await uploadMedia(file, kind, value => setProgress(Math.round((index * 100 + value) / selected.length)), abort.signal);
          if (abort.signal.aborted) break;
          setFiles(current => [...current, uploaded]);
        }
        if (!abort.signal.aborted) setInterrupted(false);
      } catch (error) { setError((error as Error).message); } finally { setUploading(false); }
    }} /></label>
    <p className="text-xs text-muted">Up to 10 files / 250 MB per submission. Audio, video and ZIP: 100 MB each. PDF: 20 MB. ZIP archives are downloaded without extraction.</p>
    {uploading && <div><p role="status">Uploading {progress}%</p><button type="button" className={button} onClick={() => controller.current?.abort()}>Cancel upload</button></div>}
    {files.map((file, index) => <div key={file.id} className="border border-border p-3 space-y-2"><WorkFile file={file} onReady={value => setReady(current => current[file.id] === value ? current : { ...current, [file.id]: value })} /><button type="button" className="inline-flex min-h-11 items-center text-sm underline" disabled={pending || uploading} aria-label={`Remove ${file.name ?? file.kind}`} onClick={() => { setFiles(current => current.filter(item => item.id !== file.id)); if (index === 0) { setPublicationId(null); setRemixDraftId(null); } }}>Remove file</button></div>)}
    {!delivery && <label className="flex min-h-11 gap-3 items-start py-2 text-sm"><input className="mt-1 h-5 w-5 shrink-0 accent-accent" disabled={pending || uploading} type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />I reviewed the current deliverable, compensation and terms.</label>}
    <p className="text-xs text-muted">Uploaded work is shared with the project owner when submitted. Unsubmitted uploads can be removed in Your publications. No payment or royalty transfer occurs.</p>
    <ErrorMessage error={error} /><button className={primary} disabled={pending || uploading || !files.length || files.some(file => ['audio','video'].includes(file.kind) && !ready[file.id]) || !description.trim() || (compose && !introduction.trim()) || (!delivery && (!ack || !item.currentOffer.available))}>{pending ? 'Submitting…' : delivery ? 'Send delivery' : compose ? 'Send request' : 'Send proposal'}</button>
  </form>;
}

function WorkFile({ file, onReady }: { file: UploadedMedia; onReady?: (ready: boolean) => void }) {
  const [failed, setFailed] = useState(false);
  const events = { onLoadedData: () => { setFailed(false); onReady?.(true); }, onError: () => { setFailed(true); onReady?.(false); } };
  return <div className="space-y-2 min-w-0"><p className="text-sm break-words">{file.name ?? `${file.kind} file`} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>
    {file.kind === 'video' ? <video src={file.url} controls playsInline preload={onReady ? 'auto' : 'metadata'} className="max-h-80 w-full" {...events} /> : file.kind === 'audio' ? <audio src={file.url} controls preload={onReady ? 'auto' : 'metadata'} className="w-full" {...events} /> : null}
    {failed && <p role="alert" className="text-danger text-sm">This file cannot be played. Use MP3/WAV or MP4/WebM, or attach unsupported stems in a ZIP.</p>}
    <a className="inline-flex min-h-11 items-center underline text-sm break-words" href={`${file.url}?download=1`} download={file.name}>Download {file.name ?? 'file'}</a>
  </div>;
}

export function CollaborationRequestPage() {
 const {user}=useAuth(),{id}=useParams<{id:string}>();
 return <ArtistMessagesAccess><RequestComposer key={`${user?.artistId}:${id}`} id={id}/></ArtistMessagesAccess>;
}
function RequestComposer({id}:{id:string}) {
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const {user}=useAuth(),client=useQueryClient(),[,navigate]=useLocation(),search=useSearch();
 const query=useQuery({queryKey:['offer-composition',user?.artistId,id],queryFn:({signal})=>apiRequest<{offer:CollaborationOffer;existing:Collaboration|null}>(`/api/offers/${id}/conversations`,{signal}),refetchOnWindowFocus:true});
 useEffect(()=>{if(query.data?.existing)navigate(`/messages/collaboration/${query.data.existing.id}${search?`?${search}`:''}`,{replace:true});},[query.data?.existing?.id,navigate,search]);
 return <section className="mx-auto w-full max-w-3xl p-4 sm:p-8 space-y-6"><ReturnLink href="/messages">All messages</ReturnLink><h1 className="text-3xl font-bold">Collaboration request</h1><ErrorMessage error={query.error}/>{query.error&&<button className={button} onClick={()=>void query.refetch()}>Retry offer</button>}{query.isLoading&&<p role="status">Loading opportunity…</p>}{query.data&&!query.data.existing&&<><p className="text-sm text-muted">Send your introduction and complete proposal together. The owner can review your files before accepting. Messages open after acceptance.</p><Link className="underline min-h-11 inline-flex items-center" href={songProjectHref(query.data.offer.projectId,query.data.offer.workId)}>{query.data.offer.projectTitle}</Link><SubmissionForm compose item={{id:Number(id),currentOffer:query.data.offer,status:'discussion',revision:1}} onDone={async result=>{await refreshMessages(client);if(!alive.current)return;if(result)navigate(`/messages/collaboration/${result.id}`);else await query.refetch();}}/></>}</section>;
}
