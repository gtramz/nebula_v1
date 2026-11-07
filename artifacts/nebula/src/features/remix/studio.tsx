import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useNotificationLock } from '@/features/notifications';
import { useQueryClient } from '@tanstack/react-query';
import type { Publication, RemixInput, UploadedMedia, RemixDraft } from '@nebula/local';
import { uploadMedia } from '@/features/discovery/publication-api';
import { saveDraft, prepareRender } from './draft-api';
import { FragmentSelector } from './fragment-selector';
import { initialFragment, type Fragment } from './fragment';
import { decodeAudio, renderMix, editableAudio } from './audio';
import { inspectMedia, recordingType, renderVideo } from './video';

const button = 'border border-border px-5 py-3 text-sm hover:border-accent disabled:opacity-40';
const field = 'block w-full min-w-0 border border-border bg-surfaceAlt p-3 text-sm mt-2';
type Contribution = { url: string; kind: 'audio' | 'video'; duration: number; name: string; audio?: AudioBuffer; blob?: Blob; mediaId?: string };
export function Studio({ original, draft, onDrafts }: { original: Publication; draft: RemixDraft; onDrafts: () => void }) {
  const client = useQueryClient(), sourceKind = original.media.kind as 'audio' | 'video';
  const [settings, setSettings] = useState<RemixInput>(draft.settings);
  const [length, setLength] = useState(0), [own, setOwn] = useState<Contribution | null>(draft.contribution ? { url: draft.contribution.url, kind: draft.contribution.kind as 'audio'|'video', duration: draft.contribution.duration, name: draft.contribution.name ?? 'Saved contribution', mediaId: draft.contribution.id } : null), [title, setTitle] = useState(draft.title), [description, setDescription] = useState(draft.description);
  const [busy, setBusy] = useState(false), [recording, setRecording] = useState<'audio' | 'video' | null>(null), [dirty, setDirty] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState('');
  useNotificationLock(busy || !!recording);
  const [mix, setMix] = useState<Blob | null>(null), [preview, setPreview] = useState(draft.render?.url ?? ''), [playable, setPlayable] = useState(false), [saved, setSaved] = useState(false);
  const base = useRef<HTMLMediaElement | null>(null), camera = useRef<HTMLVideoElement | null>(null), player = useRef<HTMLMediaElement | null>(null), canvas = useRef<HTMLCanvasElement | null>(null);
  const alive = useRef(true), controller = useRef<AbortController | null>(null), rec = useRef<MediaRecorder | null>(null), capture = useRef<MediaStream | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null), uploaded = useRef<UploadedMedia | null>(draft.render), savedDraft = useRef(draft), contributionUpload = useRef<UploadedMedia | null>(draft.contribution);
  useEffect(() => {
    if (draft.contribution?.kind !== 'audio') return;
    const abort = new AbortController(); setBusy(true); setProgress('Restoring your contribution…');
    void fetch(draft.contribution.url, { signal: abort.signal }).then(response => { if (!response.ok) throw new Error('Saved contribution unavailable. Reopen your draft to retry.'); return response.blob(); }).then(blob => decodeAudio(blob,120,true)).then(audio => { if (!abort.signal.aborted) setOwn(value => value ? { ...value, audio } : value); }).catch(cause => { if (!abort.signal.aborted) setError(cause.message); }).finally(() => { if (!abort.signal.aborted) { setBusy(false); setProgress(''); } });
    return () => abort.abort();
  }, [draft.id]);
  function release() { if (timer.current) clearTimeout(timer.current); timer.current = null; capture.current?.getTracks().forEach(track => track.stop()); capture.current = null; base.current?.pause(); if (camera.current) camera.current.srcObject = null; }
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); if (rec.current?.state === 'recording') rec.current.stop(); release(); }; }, []);
  useEffect(() => {
    const abort = new AbortController();
    void inspectMedia(original.media.url, sourceKind, 600, abort.signal).then(duration => { if (!abort.signal.aborted) { setLength(duration); if (draft.revision === 1) setSettings(value => ({ ...value, endSeconds: initialFragment(Math.floor(duration * 1000) / 1000).end })); } }).catch(cause => { if (!abort.signal.aborted) setError(cause.message); });
    return () => abort.abort();
  }, [original.media.url, sourceKind]);
  useEffect(() => () => { if (own) URL.revokeObjectURL(own.url); }, [own]);
  useEffect(() => { if (!mix) return; const url = URL.createObjectURL(mix); setPreview(url); return () => URL.revokeObjectURL(url); }, [mix]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty || busy || recording) { event.preventDefault(); event.returnValue = ''; } };
    const click = (event: MouseEvent) => { if ((dirty || busy || recording) && (event.target as Element).closest?.('a[href]') && !event.metaKey && !event.ctrlKey && !window.confirm('Leave this unsaved remix? Save a private draft to keep your tracks and settings.')) { event.preventDefault(); event.stopPropagation(); } };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true); };
  }, [dirty, busy, recording]);
  useEffect(() => {
    const hidden = () => { if (document.hidden && rec.current?.state === 'recording') rec.current.stop(); };
    document.addEventListener('visibilitychange', hidden); return () => document.removeEventListener('visibilitychange', hidden);
  }, []);
  const duration = settings.endSeconds - settings.startSeconds;
  const valid = length > 0 && duration >= .1 - 1e-9 && duration <= 60 + 1e-9 && settings.startSeconds >= 0 && settings.endSeconds <= length + .001 && settings.voiceOffset >= 0 && settings.voiceOffset < duration;
  function invalidate() { player.current?.pause(); base.current?.pause(); setMix(null); setPreview(''); setPlayable(false); setSaved(false); uploaded.current = null; setDirty(true); setError(''); }
  function change(key: keyof RemixInput, value: number) { invalidate(); setSettings(current => ({ ...current, [key]: value })); }
  function changeFragment(range: Fragment) {
    invalidate();
    setSettings(current => ({ ...current, startSeconds: range.start, endSeconds: range.end, voiceOffset: 0 }));
    if (base.current) base.current.currentTime = range.start;
  }
  const audioAllowed = sourceKind === 'audio' && original.media.size <= 25 * 1024 * 1024;
  const outputKind = own?.kind === 'audio' ? 'audio' : 'video';
  const decodedBase = useRef<AudioBuffer | null>(null);
  async function add(blob: Blob, kind: 'audio' | 'video', name: string, knownDuration?: number) {
    release(); invalidate(); contributionUpload.current = null; setOwn(null); setBusy(true); setProgress('Reading your contribution…');
    const url = URL.createObjectURL(blob), abort = new AbortController(); controller.current = abort;
    try {
      if (kind === 'audio' && !audioAllowed) throw new Error(sourceKind === 'video' ? 'A video original requires your own video.' : 'This original exceeds the 25 MB audio mixing limit. Add a video instead.');
      if (blob.size > (kind === 'audio' ? 25 : 100) * 1024 * 1024) throw new Error(`Choose ${kind} up to ${kind === 'audio' ? 25 : 100} MB.`);
      const track = kind === 'audio' ? await editableAudio(await decodeAudio(blob, 120, knownDuration !== undefined)) : null;
      const audio = track?.audio;
      const duration = audio?.duration ?? await inspectMedia(url, kind, 120, abort.signal, knownDuration);
      if (alive.current && !abort.signal.aborted) setOwn({ url, kind, duration, name, audio, blob: track?.blob ?? blob }); else URL.revokeObjectURL(url);
    } catch (cause) { URL.revokeObjectURL(url); if (alive.current) setError((cause as Error).message); }
    finally { if (alive.current) { setBusy(false); setProgress(''); } }
  }
  async function record(kind: 'audio' | 'video') {
    if (!valid || (kind === 'audio' && !audioAllowed)) return; invalidate(); setBusy(true); setProgress(kind === 'audio' ? 'Waiting for microphone permission…' : 'Waiting for camera permission…');
    try {
      const mimeType = kind === 'video' ? recordingType() : undefined;
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Recording is unavailable. Upload a file instead.');
      const stream = await navigator.mediaDevices.getUserMedia({ video: kind === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (!alive.current) { stream.getTracks().forEach(track => track.stop()); return; }
      capture.current = stream;
      if (kind === 'video' && camera.current) { camera.current.srcObject = stream; await camera.current.play(); }
      if (!alive.current) { release(); return; }
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 }); rec.current = recorder;
      const chunks: Blob[] = []; let failed = false, bytes = 0;
      recorder.ondataavailable = event => { if (event.data.size) { chunks.push(event.data); bytes += event.data.size; if (bytes > 100 * 1024 * 1024) { failed = true; if (recorder.state === 'recording') recorder.stop(); } } };
      recorder.onerror = () => { failed = true; release(); if (alive.current) { setRecording(null); setBusy(false); setError('Recording failed. Upload a file instead.'); } };
      const started = performance.now();
      recorder.onstop = () => { const elapsed = (performance.now() - started) / 1000; release(); if (alive.current) { setRecording(null); if (failed) { setError('Recording failed or exceeded 100 MB. Try a shorter clip.'); setBusy(false); } else void add(new Blob(chunks, { type: recorder.mimeType }), kind, kind === 'video' ? 'Camera recording' : 'Microphone recording', Math.min(120, elapsed)); } };
      if (base.current) { base.current.currentTime = settings.startSeconds; base.current.volume = settings.baseGain; await base.current.play(); }
      if (!alive.current) { release(); return; }
      recorder.start(250); setRecording(kind); setBusy(false); setProgress('');
      timer.current = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, duration * 1000);
    } catch (cause) { release(); if (alive.current) { setError((cause as Error).message); setBusy(false); setProgress(''); } }
  }
  async function build() {
    if (!own || !canvas.current || !valid) return; invalidate(); setBusy(true); setProgress(own.kind === 'audio' ? 'Preparing audio…' : 'Rendering video… 0%');
    const abort = new AbortController(); controller.current = abort;
    try {
      await prepareRender(draft.id, savedDraft.current.revision, abort.signal);
      if (abort.signal.aborted) return;
      let result: Blob;
      if (own.kind === 'audio') {
        if (!audioAllowed || !own.audio) throw new Error('Choose an allowed contribution.');
        if (!decodedBase.current) {
          const response = await fetch(original.media.url, { signal: abort.signal });
          if (!response.ok) throw new Error('The original audio is no longer available.');
          decodedBase.current = await decodeAudio(await response.blob(), 600, true);
        }
        if (abort.signal.aborted) return;
        result = await renderMix(decodedBase.current, own.audio, settings);
      } else result = await renderVideo({ source: original.media.url, sourceKind, contribution: own.url, contributionKind: own.kind, settings, canvas: canvas.current, signal: abort.signal, progress: value => { if (alive.current) setProgress(`Rendering video… ${value}%`); } });
      if (alive.current && !abort.signal.aborted) setMix(result);
    }
    catch (cause) { if (alive.current) setError((cause as Error).message); }
    finally { if (alive.current) { setBusy(false); setProgress(''); } }
  }
  async function save() {
    if (!valid || !title.trim() || busy) return; setBusy(true); setError(''); player.current?.pause(); base.current?.pause(); const abort = new AbortController(); controller.current = abort;
    try {
      if (own && !contributionUpload.current) {
        if (!own.blob) throw new Error('Reopen the saved draft to restore your contribution.');
        contributionUpload.current = await uploadMedia(new File([own.blob], own.kind === 'audio' ? `${own.name.replace(/\.[^.]+$/, '')}.wav` : own.name, { type: own.blob.type }), own.kind, value => { if (alive.current) setProgress(`Saving contribution… ${value}%`); }, abort.signal, draft.id);
      }
      if (mix && playable && !uploaded.current) uploaded.current = await uploadMedia(new File([mix], outputKind === 'audio' ? 'remix.wav' : mix.type.includes('mp4') ? 'remix.mp4' : 'remix.webm', { type: mix.type }), outputKind, value => { if (alive.current) setProgress(`Saving preview… ${value}%`); }, abort.signal, draft.id);
      if (!alive.current || abort.signal.aborted) return;
      const result = await saveDraft(draft.id, { revision: savedDraft.current.revision, title, description, settings,
        contributionId: contributionUpload.current?.id ?? null, contributionDuration: own?.duration ?? null,
        renderId: uploaded.current?.id ?? null }, abort.signal);
      if (alive.current) { savedDraft.current = result; setSaved(true); setDirty(false); client.setQueryData(['remix-draft', draft.ownerId, draft.id], result); }
      await client.invalidateQueries({ queryKey: ['remix-drafts'] });
      // The workspace owns its edit state. Do not refetch/remount it while editing.
    } catch (cause) { if (alive.current) setError((cause as Error).message); }
    finally { if (alive.current) { setBusy(false); setProgress(''); } }
  }
  const baseProps = { onLoadedMetadata: () => { if (base.current) base.current.currentTime = settings.startSeconds; }, controls: false, preload: 'metadata', className: 'w-full max-h-72', src: original.media.url, onPlay: () => { player.current?.pause(); if (base.current && (base.current.currentTime < settings.startSeconds || base.current.currentTime >= settings.endSeconds)) base.current.currentTime = settings.startSeconds; }, onTimeUpdate: () => { if (base.current && base.current.currentTime >= settings.endSeconds) base.current.pause(); } };
  return <section className="mx-auto w-full max-w-3xl p-6 pb-24 space-y-6">
    <div className="flex flex-wrap gap-4"><Link className="underline text-sm" href={`/discovery?post=post-${original.id}`}>Back to Discovery</Link><button className="underline text-sm min-h-11" onClick={() => { if (!dirty || window.confirm('Leave your unsaved changes?')) onDrafts(); }}>Your private drafts</button></div>
    <header><p className="voice text-xs text-accent">MAKE IT YOUR OWN</p><h1 className="text-3xl font-bold">Remix studio</h1></header>
    <div className="border border-border p-5 space-y-2"><p>Original: <strong>{original.title}</strong> · {original.artistName}</p></div>
    <fieldset disabled={busy || !!recording} className="space-y-6 disabled:opacity-60">
      <section className="space-y-4"><h2 className="text-xl font-bold">1. Choose the base fragment</h2>
        {sourceKind === 'video' ? <video {...baseProps} playsInline ref={element => { base.current = element; }} aria-label="Original fragment" /> : <audio {...baseProps} className="hidden" ref={element => { base.current = element; }} aria-label="Original fragment" />}
        <FragmentSelector postId={original.id} mediaId={original.media.id} length={length} range={{start:settings.startSeconds,end:settings.endSeconds}} mediaRef={base} disabled={busy || !!recording} onChange={changeFragment} />
        {length > 0 && <p className="text-xs text-muted">Original duration: {length.toFixed(2)} seconds. Selected: {duration.toFixed(2)} seconds.</p>}
      </section>
      <section className="space-y-4"><h2 className="text-xl font-bold">2. Add your contribution</h2>
        <label className="block">{sourceKind === 'video' ? 'Upload video' : 'Upload file'}<input className={field} type="file" accept={audioAllowed ? 'audio/*,video/mp4,video/webm' : 'video/mp4,video/webm'} onChange={e => {
          const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
          const kind = file.type.startsWith('audio/') || /\.(wav|mp3|ogg|m4a|flac)$/i.test(file.name) ? 'audio' : file.type.startsWith('video/') || /\.(mp4|webm)$/i.test(file.name) ? 'video' : null;
          if (!kind) { setError('Choose an audio or video file.'); return; }
          void add(file, kind, file.name);
        }} /></label>
        <p className="text-xs text-muted">Contributions: up to 120 seconds. {audioAllowed ? 'Audio: up to 25 MB. ' : ''}Video: up to 100 MB. Long contributions are trimmed; short videos hold their last frame.</p>
        {sourceKind === 'audio' && !audioAllowed && <p className="text-sm text-muted">This original exceeds the 25 MB audio mixing limit. You can still add a video.</p>}
        <div className="flex flex-wrap gap-3">{sourceKind === 'audio' && <button className={button} disabled={!valid || !audioAllowed} onClick={() => void record('audio')}>Record audio</button>}<button className={button} disabled={!valid} onClick={() => void record('video')}>Record video</button></div>
        <p className="text-xs text-muted">Use headphones while the original plays. Recording requests only the devices needed and stops at the fragment end. Device latency may affect alignment.</p>
        <p className="text-sm text-accent" role="status">{sourceKind === 'video' ? 'A video original requires your own video. Result: both videos with mixed sound.' : own?.kind === 'video' ? 'Result: your video with the original audio and your sound.' : own?.kind === 'audio' ? 'Result: the original audio mixed with your sound.' : 'Add audio for an audio remix, or video for a video remix.'}</p>
        {own && <p role="status" className="text-sm text-accent break-words">Your contribution is ready · {own.name} · {own.duration.toFixed(2)} seconds</p>}
        <div className="grid grid-cols-2 gap-4"><label>Base volume <span className="text-muted">{Math.round(settings.baseGain * 100)}%</span><input aria-label="Base volume" className={field} type="range" min="0.05" max="1" step="0.05" value={settings.baseGain} onChange={e => change('baseGain', Number(e.target.value))} /></label><label>Your contribution volume <span className="text-muted">{Math.round(settings.voiceGain * 100)}%</span><input aria-label="Your contribution volume" className={field} type="range" min="0.05" max="1" step="0.05" value={settings.voiceGain} onChange={e => change('voiceGain', Number(e.target.value))} /></label></div>
      </section>
      <p className="text-xs text-muted">Volume: 5–100%, no mute. Changes require a rebuilt preview; preview and saved mix use the same levels.</p><button className={button} onClick={() => { invalidate(); setSettings(current => ({ ...current, baseGain: .65, voiceGain: .8 })); }}>Reset volumes</button>
      <section aria-label="Remix preview" className="space-y-4"><h2 className="text-xl font-bold">3. Preview your mix</h2>{own?.kind === 'video' && <p className="text-sm text-muted">Rendering takes the length of the fragment. Keep this tab visible. You can cancel and try again.</p>}<button className={button} disabled={!valid || !own} onClick={() => void build()}>Build preview</button>
        {preview && (outputKind === 'video' ? <video ref={element => { player.current = element; }} src={preview} controls playsInline preload="auto" className="w-full max-h-96" onPlay={() => base.current?.pause()} onLoadedData={() => setPlayable(true)} onError={() => { setPlayable(false); setError('Preview could not be played. Rebuild your mix.'); }} /> : <audio ref={element => { player.current = element; }} src={preview} controls preload="auto" className="w-full" onPlay={() => base.current?.pause()} onLoadedData={() => setPlayable(true)} onError={() => { setPlayable(false); setError('Preview could not be played. Rebuild your mix.'); }} />)}
      </section>
      <label className="block">Remix title<input className={field} value={title} maxLength={160} onChange={e => { setTitle(e.target.value); setDirty(true); setSaved(false); }} /></label><label className="block">Description<textarea aria-label="Description" className={field} rows={3} maxLength={2000} value={description} onChange={e => { setDescription(e.target.value); setDirty(true); setSaved(false); }} /></label>
      <div className="flex flex-wrap gap-3"><button className={button} disabled={!valid || !title.trim() || (!!mix && !playable)} onClick={() => void save()}>Save remix draft</button></div>
    </fieldset>
    <video ref={camera} muted playsInline className={recording === 'video' ? 'w-full max-h-72' : 'hidden'} aria-label="Camera preview" />
    <canvas ref={canvas} className={progress.startsWith('Rendering') ? 'w-full max-h-72 object-contain' : 'hidden'} aria-label="Video composition" />
    {recording && <div role="status" className="space-y-3"><p>{recording === 'video' ? 'Recording your camera…' : 'Recording your microphone…'}</p><button className={button} onClick={() => { if (rec.current?.state === 'recording') rec.current.stop(); }}>Stop recording</button></div>}
    {busy && <div className="space-y-3"><p role="status">{progress || 'Saving remix…'}</p>{!progress.includes('permission') && <button className={button} onClick={() => controller.current?.abort()}>Cancel operation</button>}</div>}
    {error && <p role="alert" className="text-danger">{error}</p>}
    {saved && <div role="status" className="space-y-3"><p className="text-accent">Remix draft saved</p><p>Your tracks and settings are private and can be reopened.</p>{savedDraft.current.render && savedDraft.current.attribution.projectId && <Link className={`${button} inline-block`} href="/studio/remix/proposal">Propose to original project</Link>}</div>}
    {!dirty && !saved && draft.render && draft.attribution.projectId && <Link className={`${button} inline-block`} href="/studio/remix/proposal">Propose to original project</Link>}
    {error.includes('another tab') && <button className={button} onClick={() => { if (window.confirm('Discard these local edits and reopen the latest saved draft?')) { setDirty(false); setTimeout(() => window.location.reload(), 0); } }}>Reopen saved draft</button>}
    <p className="text-xs text-muted">Private workspace. Only a submitted final mix is shared with collaboration participants. Public remix release is not available.</p>
  </section>;
}
