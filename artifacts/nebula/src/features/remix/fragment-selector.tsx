import { useEffect, useMemo, useRef, useState, type RefObject, type PointerEvent, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, type Waveform } from '@nebula/local';
import { clamp, fixedFragment, clipDurations, nextClipDuration, timeLabel, type Fragment } from './fragment';

const control = 'min-h-11 min-w-11 border border-border px-4 py-2 text-sm hover:border-accent disabled:opacity-40';
type Drag = { mode: 'move' | 'start' | 'end' | 'seek' | 'overview'; x: number; range: Fragment; width: number; window: number };
export function FragmentSelector({ postId, mediaId, length, range, mediaRef, disabled, onChange }: {
  postId: number; mediaId: string; length: number; range: Fragment; mediaRef: RefObject<HTMLMediaElement | null>; disabled: boolean; onChange: (range: Fragment) => void;
}) {
  const [windowSize, setWindowSize] = useState(60), [viewStart, setViewStart] = useState(0);
  const [cursor, setCursor] = useState(0), [playing, setPlaying] = useState(false), [error, setError] = useState('');
  const track = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null);
  const waveform = useQuery({ queryKey: ['remix-waveform', postId, mediaId], queryFn: () => apiRequest<Waveform>(`/api/publications/${postId}/waveform`), retry: false, refetchOnWindowFocus: false, gcTime: 0 });
  const data = waveform.data?.mediaId === mediaId ? waveform.data : undefined;
  const span = Math.max(.1, Math.min(windowSize, length || 60)), view = clamp(viewStart, 0, length - span), duration = range.end - range.start;
  const percent = (time: number) => (time - view) / span * 100;
  useEffect(() => { if (length) { setWindowSize(Math.min(60, length)); setViewStart(clamp(range.start, 0, length - Math.min(60, length))); } }, [length]);
  useEffect(() => {
    const media = mediaRef.current; if (!media) return;
    let frame = 0;
    const update = () => {
      if (media.currentTime >= range.end && !media.paused) { media.pause(); media.currentTime = range.end; }
      setCursor(clamp(media.currentTime, range.start, range.end)); setPlaying(!media.paused);
    };
    const tick = () => { update(); if (!media.paused) frame = requestAnimationFrame(tick); };
    const play = () => { cancelAnimationFrame(frame); tick(); };
    media.addEventListener('timeupdate', update); media.addEventListener('play', play); media.addEventListener('pause', update); media.addEventListener('ended', update);
    update(); if (!media.paused) play();
    return () => { cancelAnimationFrame(frame); media.removeEventListener('timeupdate', update); media.removeEventListener('play', play); media.removeEventListener('pause', update); media.removeEventListener('ended', update); };
  }, [mediaRef, range.start, range.end]);
  function seek(time: number) { if (disabled || !mediaRef.current) return; const value = clamp(time, range.start, range.end); mediaRef.current.currentTime = value; setCursor(value); }
  function reveal(next: Fragment) { if (next.start < view || next.end > view + span) setViewStart(clamp(next.start, 0, length - span)); }
  function commit(next: Fragment, follow = false) { if (next.start === range.start && next.end === range.end) return; onChange(next); setCursor(next.start); if (follow) reveal(next); }
  function preset(value: number) { const next = fixedFragment(range.start, value, length); if (value > span) setWindowSize(value); commit(next, true); }
  function move(value: number) { commit(fixedFragment(value, duration, length), true); }
  function startDrag(event: PointerEvent<HTMLElement>, operation: Drag['mode']) {
    if (disabled || !length || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    const rect = operation === 'overview' ? event.currentTarget.getBoundingClientRect() : track.current!.getBoundingClientRect();
    const next = operation === 'overview' ? fixedFragment((event.clientX - rect.left) / rect.width * length - duration / 2, duration, length) : range;
    drag.current = { mode: operation, x: event.clientX, range: next, width: rect.width, window: operation === 'overview' ? length : span };
    if (operation === 'overview') commit(next, true);
    if (operation === 'seek') seek(view + (event.clientX - rect.left) / rect.width * span);
  }
  function moveDrag(event: PointerEvent<HTMLElement>) {
    const current = drag.current; if (!current || disabled) return;
    const delta = (event.clientX - current.x) / current.width * current.window;
    if (current.mode === 'seek') { const rect = track.current!.getBoundingClientRect(); seek(view + (event.clientX - rect.left) / rect.width * span); }
    else commit(fixedFragment(current.range.start + delta, current.range.end - current.range.start, length), current.mode === 'overview');
  }
  function endDrag(event: PointerEvent<HTMLElement>) { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
  function keyboard(event: KeyboardEvent, operation: Drag['mode']) {
    if (!['ArrowLeft','ArrowRight','ArrowDown','ArrowUp','Home','End'].includes(event.key) || disabled) return;
    event.preventDefault(); const delta = (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1) * (event.shiftKey ? 1 : .1);
    if (operation === 'seek') seek(event.key === 'Home' ? range.start : event.key === 'End' ? range.end : cursor + delta);
    else move(event.key === 'Home' ? 0 : event.key === 'End' ? length - duration : range.start + delta);
  }
  const gestures = (operation: Drag['mode']) => ({ onPointerDown: (e: PointerEvent<HTMLElement>) => startDrag(e, operation), onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag, onKeyDown: (e: KeyboardEvent) => keyboard(e, operation) });
  function wave(from: number, width: number, height: number, bars: number) {
    if (!data?.hasAudio) return <line x1="0" y1={height/2} x2="1000" y2={height/2} stroke="currentColor" strokeWidth="1" />;
    let path = '';
    for (let i = 0; i < bars; i++) {
      const first = Math.floor((from + i / bars * width) * data.pointsPerSecond), last = Math.ceil((from + (i + 1) / bars * width) * data.pointsPerSecond);
      let amplitude = 0; for (let j = first; j < last; j++) amplitude = Math.max(amplitude, data.peaks[j] ?? 0);
      const x = (i + .5) / bars * 1000, h = amplitude * (height - 8) / 2;
      path += `M${x},${height/2-h}V${height/2+h || height/2} `;
    }
    return <><line x1="0" y1={height/2} x2="1000" y2={height/2} stroke="currentColor" strokeWidth=".5" /><path d={path} stroke="currentColor" strokeWidth="2" /></>;
  }
  const detailWave = useMemo(() => wave(view, span, 120, 500), [data, view, span]);
  const overviewWave = useMemo(() => wave(0, length, 40, 250), [data, length]);
  return <div className="space-y-4" aria-label="Fragment selector">
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Clip duration">
      <button type="button" className={`${control} border-accent text-accent`} aria-label={`Clip duration: ${Number(duration.toFixed(3))} seconds`} title={`Change to ${nextClipDuration(duration, length)} seconds`} disabled={disabled || clipDurations(length).length < 2} onClick={() => preset(nextClipDuration(duration, length))}>{Number(duration.toFixed(3))}s <span aria-hidden="true">↻</span></button>
    </div>
    <p className="text-xs text-muted">Drag the selection or either edge to move your fixed-length clip.</p>
    <div ref={track} className="remix-waveform relative h-44 overflow-hidden rounded-xl border border-border bg-surfaceAlt touch-pan-y" data-testid="waveform-track">
      <svg viewBox="0 0 1000 120" preserveAspectRatio="none" className="absolute top-3 h-28 w-full text-muted opacity-35" aria-hidden="true">{detailWave}</svg>
      <svg viewBox="0 0 1000 120" preserveAspectRatio="none" className="absolute top-3 h-28 w-full text-accent" style={{clipPath:`inset(0 ${clamp(100-percent(range.end),0,100)}% 0 ${clamp(percent(range.start),0,100)}%)`}} aria-hidden="true">{detailWave}</svg>
      <div className="absolute inset-x-0 top-0 h-32" onPointerDown={e => startDrag(e, 'seek')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
      <button type="button" role="slider" aria-label="Move selected fragment" aria-valuemin={0} aria-valuemax={Math.max(0,length-duration)} aria-valuenow={range.start} aria-valuetext={`Start ${timeLabel(range.start)}, duration ${timeLabel(duration)}`} disabled={disabled || !length} className="absolute top-0 h-32 min-w-11 border-y-2 border-accent bg-accent/10 touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" style={{left:`${percent(range.start)}%`,width:`${duration/span*100}%`}} {...gestures('move')} />
      {(['start','end'] as const).map(edge => <button key={edge} type="button" role="slider" aria-label={edge === 'start' ? 'Move clip start' : 'Move clip end'} aria-valuemin={edge === 'start' ? 0 : duration} aria-valuemax={edge === 'start' ? length-duration : length} aria-valuenow={range[edge]} aria-valuetext={`${timeLabel(range[edge])}, moves fixed-length clip`} disabled={disabled || !length} className="absolute top-0 z-10 flex h-32 w-11 touch-none items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" style={{left:`calc(${clamp(percent(range[edge]),0,100)}% - ${edge==='start' ? 0 : 44}px)`, visibility:range[edge]<view-.001||range[edge]>view+span+.001?'hidden':undefined}} {...gestures(edge)}><span className="flex h-14 w-3 items-center justify-center rounded bg-accent text-black" aria-hidden="true">∥</span></button>)}
      <div className="pointer-events-none absolute top-0 h-32 border-l-2 border-cream" style={{left:`${clamp(percent(cursor),0,100)}%`}} />
      <button type="button" role="slider" aria-label="Playback position" aria-valuemin={range.start} aria-valuemax={range.end} aria-valuenow={cursor} aria-valuetext={timeLabel(cursor)} disabled={disabled || !length} className="absolute bottom-0 z-20 h-11 w-11 touch-none text-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" style={{left:`clamp(0px, calc(${percent(cursor)}% - 22px), calc(100% - 44px))`}} {...gestures('seek')}><span aria-hidden="true">▲</span></button>
    </div>
    <div className="flex justify-between text-xs text-muted tabular-nums"><span>{timeLabel(view)}</span><span>{timeLabel(Math.min(length,view+span))}</span></div>
    <p className="text-xs text-muted">Original overview · tap or drag to move your clip</p>
    <div className="remix-waveform relative h-11 overflow-hidden rounded border border-border text-muted"><svg aria-hidden="true" viewBox="0 0 1000 40" preserveAspectRatio="none" className="h-full w-full">{overviewWave}</svg><div className="absolute inset-y-0 border border-accent bg-accent/10" style={{left:`${length?range.start/length*100:0}%`,width:`${length?duration/length*100:0}%`}}/><div className="absolute inset-y-0 border border-cream" style={{left:`${length?view/length*100:0}%`,width:`${length?span/length*100:100}%`}}/><button type="button" role="slider" aria-label="Clip location in original" aria-valuemin={0} aria-valuemax={Math.max(0,length-duration)} aria-valuenow={range.start} aria-valuetext={timeLabel(range.start)} disabled={disabled||!length} className="absolute inset-0 h-11 w-full touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" {...gestures('overview')} /></div>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={control} disabled={disabled||!length} onClick={()=>{const media=mediaRef.current;if(!media)return;if(!media.paused)media.pause();else{if(media.currentTime<range.start||media.currentTime>=range.end)media.currentTime=range.start;setError('');void media.play().catch(()=>setError('Playback is unavailable. Try again.'));}}}>{playing?'Pause':'Play selection'}</button>
      <button type="button" className={control} aria-label="Zoom in" disabled={disabled||span<=Math.min(1,length)} onClick={()=>{setWindowSize(Math.max(Math.min(1,length),span/2));setViewStart(range.start);}}>+</button>
      <button type="button" className={control} aria-label="Zoom out" disabled={disabled||span>=length} onClick={()=>setWindowSize(Math.min(length,span*2))}>−</button>
      <button type="button" className={control} disabled={disabled||!length} onClick={()=>{setWindowSize(duration);setViewStart(range.start);}}>Fit selection</button>
      <span className="text-xs tabular-nums" aria-live="off">{timeLabel(cursor)} / {timeLabel(length)}</span>
    </div>
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm tabular-nums" role="status"><span>Start <strong>{timeLabel(range.start)}</strong></span><span>End <strong>{timeLabel(range.end)}</strong></span><span>Duration <strong>{timeLabel(duration)}</strong></span></div>
    <p className="text-xs text-muted" role="status">{waveform.isPending?'Loading waveform…':waveform.isError?'Waveform unavailable. You can still select and play your clip.':data&&!data.hasAudio?'No audio track':'Use arrow keys for 0.1s adjustments; hold Shift for 1s.'}</p>
    {waveform.isError&&<button type="button" className={control} disabled={disabled||waveform.isFetching} onClick={()=>void waveform.refetch()}>Retry waveform</button>}
    {error&&<p role="alert" className="text-danger">{error}</p>}
  </div>;
}
