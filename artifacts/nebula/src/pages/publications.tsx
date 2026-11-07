import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, isServerMode, useListProjects, type Publication, type PublicationInput, type UploadedMedia } from '@nebula/local';
import { useAuth } from '@/context/AuthContext';
import { ContentWidth } from '@/components/shell/app-shell';
import { savePublication, uploadMedia, usePublication, usePublications } from '@/features/discovery/publication-api';

const button = 'border border-border px-5 py-3 text-xs hover:border-ink disabled:opacity-40';
const field = 'w-full border border-border bg-surfaceAlt p-3 text-sm';

function ArtistGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!isServerMode()) return <ContentWidth className="py-12 space-y-4"><h1 className="text-3xl">Publishing needs the server</h1><p>Open the persistent server to publish your work.</p><Link href="/discovery">Back to Discovery</Link></ContentWidth>;
  if (user?.role !== 'artist') return <ContentWidth className="py-12 space-y-4"><h1 className="text-3xl">An artist space</h1><p>Log in with an artist account to publish and manage your work.</p><Link href="/login">Log in</Link></ContentWidth>;
  return <>{children}</>;
}

export function Publications() { return <ArtistGate><PublicationList /></ArtistGate>; }
function PublicationList() {
  const { user } = useAuth();
  const query = usePublications(true);
  const client = useQueryClient();
  const change = useMutation({ mutationFn: (post: Publication) => savePublication({ ...post, status: post.status === 'published' ? 'withdrawn' : 'published' }, post),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['publications'] }); void client.invalidateQueries({ queryKey: ['publication'] }); } });
  const uploads = useQuery({ queryKey: ['unused-uploads', user?.artistId], queryFn: () => apiRequest<UploadedMedia[]>('/api/uploads') });
  const remove = useMutation({ mutationFn: (id: string) => apiRequest(`/api/uploads/${id}`, { method: 'DELETE' }), onSuccess: () => { void uploads.refetch(); } });
  const posts = query.data?.pages.flatMap(page => page.items) ?? [];
  return <ContentWidth className="py-10 space-y-8">
    <header className="flex items-center justify-between gap-4"><div><p className="voice text-xs text-muted">artist studio</p><h1 className="text-3xl font-bold mt-2">Your publications</h1></div><Link href="/publish" className="bg-cream text-bg px-5 py-3 text-xs">New publication</Link></header>
    <Link href="/collaborations" className="inline-block underline text-sm">Collaborations & messages</Link>
    <p className="text-muted text-sm">Publish your sound, connect it to a project, and choose who can remix it.</p>
    {query.isLoading && <p>Loading publications…</p>}
    {query.error && <p role="alert">{query.error.message} <button onClick={() => query.refetch()}>Retry</button></p>}
    {!query.isLoading && !query.error && !posts.length && <div className="border border-border p-10"><h2 className="text-xl mb-3">Your first idea starts here.</h2><p className="text-muted">Upload a video or audio track. Keep it as a draft until you are ready.</p></div>}
    {change.error && <p role="alert" className="text-danger">{change.error.message}</p>}
    <div className="grid md:grid-cols-2 gap-6">{posts.map(post => <article key={post.id} className="border border-border p-6 space-y-4" aria-label={`${post.title} publication`}>
      {post.coverUrl && <img src={post.coverUrl} alt="" className="w-full h-40 object-cover" />}
      <p className="voice text-xs text-muted">{post.status} · {post.media.kind}</p><h2 className="text-xl font-bold break-words">{post.title}</h2>
      <p className="text-sm text-muted line-clamp-3 break-words">{post.description}</p>
      {post.remix && <p className="text-sm text-accent">Remix of {post.remix.title} · {post.remix.artistName}</p>}
      <p className="text-xs">{post.allowRemix ? 'Remixes allowed' : 'Remixes not allowed'}{post.project ? ` · ${post.project.title}` : ''}</p>
      <div className="flex flex-wrap gap-3"><Link href={`/publish/${post.id}`} className={button}>Edit publication</Link><button className={button} disabled={change.isPending} onClick={() => change.mutate(post)}>{post.status === 'published' ? 'Withdraw' : 'Publish'}</button>{post.status === 'published' && <Link href={`/discovery?post=post-${post.id}`} className={button}>View in Discovery</Link>}{post.remix?.projectId && <Link className={button} href={`/remix/${post.id}/proposal`}>Propose to original project</Link>}</div>
    </article>)}</div>
    {query.hasNextPage && <button className={button} disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>Load more publications</button>}
    {!!uploads.data?.length && <details className="border-t border-border pt-6"><summary>Unused uploads ({uploads.data.length})</summary><p className="text-muted text-sm my-3">Files from cancelled or replaced publications and collaboration uploads. Removing these does not affect any saved publication.</p>{uploads.data.map(file => <div key={file.id} className="flex justify-between items-center gap-4 py-3 border-b border-border"><span className="text-xs">{file.name ?? file.kind} · {(file.size / 1024 / 1024).toFixed(1)} MB</span><button className={button} disabled={remove.isPending} onClick={() => remove.mutate(file.id)}>Remove unused file</button></div>)}</details>}
    {remove.error && <p role="alert">{remove.error.message}</p>}
  </ContentWidth>;
}

export function PublicationEditor() {
  const { id } = useParams<{ id?: string }>();
  const query = usePublication(id ? Number(id) : undefined);
  const { user } = useAuth();
  return <ArtistGate>{id && query.isLoading ? <ContentWidth className="py-10">Loading publication…</ContentWidth> : query.error ? <ContentWidth className="py-10"><p role="alert">{query.error.message}</p><Link href="/studio">Back to studio</Link></ContentWidth> : id && query.data?.artistId !== user?.artistId ? <ContentWidth className="py-10">Publication not found.</ContentWidth> : <PublicationForm key={id ?? 'new'} existing={query.data} />}</ArtistGate>;
}

function PublicationForm({ existing }: { existing?: Publication }) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const projects = useListProjects();
  const client = useQueryClient();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [allowRemix, setAllowRemix] = useState(existing?.allowRemix ?? false);
  const [projectId, setProjectId] = useState(String(existing?.projectId ?? ''));
  const [media, setMedia] = useState<UploadedMedia | null>(existing?.media ?? null);
  const [cover, setCover] = useState<{ id: string; url: string } | null>(existing?.coverId ? { id: existing.coverId, url: existing.coverUrl! } : null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [playable, setPlayable] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const [dirty, setDirty] = useState(false);
  useEffect(() => () => { alive.current = false; abort.current?.abort(); }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || progress !== null) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, progress]);
  const save = useMutation({ mutationFn: (status: PublicationInput['status']) => {
    if (!media) throw new Error('Upload audio or video first.');
    return savePublication({ title, description, mediaId: media.id, coverId: cover?.id ?? null, allowRemix, projectId: projectId ? Number(projectId) : null, status }, existing);
  }, onSuccess: async () => {
    setDirty(false);
    await client.invalidateQueries({ queryKey: ['publications'] }); await client.invalidateQueries({ queryKey: ['publication'] }); await client.invalidateQueries({ queryKey: ['unused-uploads', user?.artistId] }); navigate('/studio');
  } });
  async function selectFile(file: File | undefined, isCover: boolean) {
    if (!file) return;
    setError('');
    const kind = isCover ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : null;
    if (!kind) { setError('Choose an MP4/WebM video or MP3/WAV/OGG audio file.'); return; }
    if (file.size > (isCover ? 5 : 100) * 1024 * 1024) { setError(`${isCover ? 'Cover' : 'Media'} exceeds the ${isCover ? 5 : 100} MB limit.`); return; }
    const controller = new AbortController(); abort.current = controller; setProgress(0);
    try {
      const uploaded = await uploadMedia(file, kind, value => { if (alive.current) setProgress(value); }, controller.signal);
      if (!alive.current) return;
      if (isCover) setCover(uploaded); else { setMedia(uploaded); setPlayable(false); }
      setDirty(true); void client.invalidateQueries({ queryKey: ['unused-uploads', user?.artistId] });
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Upload failed.'); }
    finally { if (alive.current) setProgress(null); abort.current = null; }
  }
  const busy = progress !== null || save.isPending;
  return <ContentWidth className="py-10 max-w-3xl space-y-8">
    <header><p className="voice text-xs text-muted">artist studio</p><h1 className="text-3xl font-bold mt-2">{existing ? 'Edit publication' : 'Share your sound'}</h1></header>
    <form className="space-y-6" onSubmit={event => { event.preventDefault(); save.mutate('published'); }} onChange={() => setDirty(true)}>
      <fieldset disabled={busy} className="space-y-6 disabled:opacity-60">
        {existing?.remix ? <p className="text-sm text-accent">Remix of {existing.remix.title} · {existing.remix.artistName}. The mix and its credit are fixed; start a new remix to change its media.</p> : <label className="block space-y-2"><span>Audio or video</span><input type="file" accept="video/mp4,video/webm,audio/mpeg,audio/wav,audio/x-wav,audio/ogg" className={field} onChange={event => { void selectFile(event.target.files?.[0], false); event.target.value = ''; }} /><span className="block text-xs text-muted">MP4, WebM, MP3, WAV or OGG · up to 100 MB</span></label>}
        {media && <div className="border border-border p-4">{media.kind === 'video' ? <video key={media.id} src={media.url} controls playsInline preload="metadata" className="max-h-80 w-full" onLoadedData={() => setPlayable(true)} onError={() => { setPlayable(false); setError('This video cannot be played. Export it as MP4 with H.264/AAC or WebM and try again.'); }} /> : <audio key={media.id} src={media.url} controls preload="auto" className="w-full" onLoadedData={() => setPlayable(true)} onError={() => { setPlayable(false); setError('This audio cannot be played. Try another MP3, WAV or OGG file.'); }} />}</div>}
        <label className="block space-y-2"><span>Title</span><input className={field} value={title} onChange={event => setTitle(event.target.value)} maxLength={160} required /></label>
        <label className="block space-y-2"><span>Description</span><textarea className={field} value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} rows={4} /></label>
        <label className="block space-y-2"><span>Cover image (optional)</span><input type="file" className={field} accept="image/png,image/jpeg,image/webp" onChange={event => { void selectFile(event.target.files?.[0], true); event.target.value = ''; }} /><span className="block text-xs text-muted">PNG, JPEG or WebP · up to 5 MB</span></label>
        {cover && <div className="flex gap-4 items-center"><img src={cover.url} alt="Publication cover preview" className="h-32 w-32 object-cover" /><button type="button" className={button} onClick={() => { setCover(null); setDirty(true); }}>Remove cover</button></div>}
        <label className="block space-y-2"><span>Link a project (optional)</span><select className={field} value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">Independent publication</option>{projects.data?.filter(project => project.artistId === user?.artistId).map(project => <option key={project.id} value={project.id}>{project.title}{project.status === 'draft' ? ' (draft — publish project first)' : ''}</option>)}</select></label>
        {projects.error && <p role="alert">Could not load your projects. <button type="button" onClick={() => projects.refetch()}>Retry</button></p>}
        <div className="border border-border p-5 space-y-3"><label className="flex gap-3 items-center"><input type="checkbox" disabled={!!existing?.remix} checked={allowRemix} onChange={event => setAllowRemix(event.target.checked)} />Allow other artists to remix this publication</label><p className="text-xs text-muted">Audio and video originals can be used in the remix studio. Remixes of remixes are not supported. Permission does not grant collaboration approval or royalties. Disabling it blocks new remixes and future publication of saved drafts; existing published remixes remain available.</p></div>
      </fieldset>
      {progress !== null && <div role="status" className="space-y-3"><p>Uploading… {progress}%</p><progress className="w-full" value={progress} max={100} /><button type="button" className={button} onClick={() => abort.current?.abort()}>Cancel upload</button></div>}
      {(error || save.error) && <p role="alert" className="text-danger">{error || save.error?.message}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="bg-cream text-bg px-6 py-3 text-sm disabled:opacity-40" disabled={busy || !media || !playable || !title.trim()}>{save.isPending ? 'Saving…' : existing?.status === 'published' ? 'Save changes' : 'Publish'}</button>
        <button type="button" className={button} disabled={busy || !media || !title.trim()} onClick={() => save.mutate('draft')}>Save draft</button>
        <button type="button" className={button} disabled={save.isPending} onClick={() => { if (!dirty || window.confirm('Leave without saving these changes? Uploaded files will remain in your unused uploads.')) { abort.current?.abort(); navigate('/studio'); } }}>Cancel</button>
      </div>
      <p className="text-xs text-muted">Drafts are visible only to you. Published audio, video and covers are public. Withdrawing a publication removes public access on this server; copies already downloaded cannot be recalled.</p>
    </form>
  </ContentWidth>;
}
