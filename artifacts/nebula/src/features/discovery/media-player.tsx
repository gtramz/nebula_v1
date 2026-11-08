import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, type Waveform } from '@nebula/local';
import { Disc3, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { Link } from 'wouter';
import { useNotificationsOpen } from '@/features/notifications';
import { useIsMobile } from '@/hooks/use-mobile';
import { DiscoveryArtwork } from './cover-artwork';
import type { DemoPost } from './demo-posts';

const time = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

export function VideoDiscoveryPlayer({ children }: { children: ReactNode }) {
  return <div className="discovery-video-stage">{children}</div>;
}
export function AudioDiscoveryCard({ post, info, controls, onProjectNavigate }: { post: DemoPost; info: ReactNode; controls: ReactNode; onProjectNavigate?: () => void }) {
  const isMobile = useIsMobile();
  const linkedProject = isMobile && post.project && Number.isInteger(post.projectId) && !!post.projectId && post.projectId > 0;
  const artwork = <DiscoveryArtwork post={post} useProjectCover={isMobile} />;
  return <>
    <div className="discovery-audio-stage">
      {linkedProject
        ? <Link className="discovery-cover discovery-cover-link" href={`/project/${post.projectId}${post.workId ? `?song=${post.workId}` : ''}`} aria-label={`View project: ${post.project!.title}`} onClick={onProjectNavigate}>{artwork}</Link>
        : <div className="discovery-cover">{artwork}</div>}
    </div>
    {info}
    {controls}
  </>;
}

function WaveformProgress({ data, progress }: { data: Waveform; progress: number }) {
  const id = useId().replaceAll(':', '');
  // Reduce only for drawing; every visible column uses the peak in its source interval.
  const path = useMemo(() => {
    const count = Math.min(400, data.peaks.length);
    // Normalize the display to this track’s loudest peak; silence stays a flat line.
    const ceiling = data.peaks.reduce((max, peak) => Math.max(max, peak), 0) || 1;
    return Array.from({ length: count }, (_, i) => {
      const from = Math.floor(i * data.peaks.length / count), to = Math.floor((i + 1) * data.peaks.length / count);
      let peak = 0; for (let n = from; n < to; n++) peak = Math.max(peak, data.peaks[n]);
      const amplitude = Math.min(1, peak / ceiling) * 27, x = (i + .5) / count * 1000;
      return `M${x},${30 - amplitude}V${30 + amplitude}`;
    }).join(' ');
  }, [data]);
  return <svg className="discovery-waveform" viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden="true">
    <defs><clipPath id={id}><rect width={progress * 1000} height="60" /></clipPath></defs>
    <g stroke="#555" strokeWidth="2"><path d="M0 30H1000" /><path d={path} /></g>
    <g stroke="currentColor" strokeWidth="2" clipPath={`url(#${id})`}><path d="M0 30H1000" /><path d={path} /></g>
  </svg>;
}

export const DiscoveryMedia = memo(function DiscoveryMedia({ post, active, nearby, blocked, waveformAccess, info }: { post: DemoPost; active: boolean; nearby: boolean; blocked: boolean; waveformAccess: boolean; info: ReactNode }) {
  const notificationsOpen = useNotificationsOpen();
  blocked = blocked || notificationsOpen;
  const media = useRef<HTMLMediaElement | null>(null), wasActive = useRef(false);
  const allowed = useRef(false); allowed.current = active && !blocked;
  const [playing, setPlaying] = useState(false), [muted, setMuted] = useState(post.media.kind === 'video');
  const [volume, setVolume] = useState(1), [progress, setProgress] = useState(0), [duration, setDuration] = useState(post.media.durationSeconds);
  const [failed, setFailed] = useState(false), [buffering, setBuffering] = useState(false), [notice, setNotice] = useState('');
  const audio = post.media.kind === 'audio';
  const waveform = useQuery({ queryKey: ['discovery-waveform', post.id, post.media.src],
    queryFn: ({ signal }) => apiRequest<Waveform>(`/api/publications/${post.id.slice(5)}/waveform`, { signal }),
    enabled: active && audio && waveformAccess, retry: false, refetchOnWindowFocus: false, staleTime: 60_000, gcTime: 60_000 });
  const wave = waveformAccess ? waveform.data : undefined;
  useLayoutEffect(() => {
    allowed.current = active && !blocked;
    const element = media.current; if (!element) return;
    if (!active || blocked) element.pause();
    if (active && !wasActive.current && !blocked && !audio && !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      element.muted = true; setMuted(true);
      void element.play().then(() => { if (!allowed.current || document.hidden) element.pause(); }).catch(() => { if (allowed.current) setNotice('Press play to watch.'); });
    }
    wasActive.current = active;
  }, [active, blocked, audio, nearby]);
  useEffect(() => {
    const element = media.current;
    if (!nearby || !element) return;
    const pause = () => { if (document.hidden) element?.pause(); };
    document.addEventListener('visibilitychange', pause);
    return () => { element.pause(); element.removeAttribute('src'); element.load(); document.removeEventListener('visibilitychange', pause); };
  }, [nearby]);
  async function toggle() {
    const element = media.current; if (!element || !allowed.current) return;
    if (!element.paused) { element.pause(); return; }
    try { await element.play(); if (!allowed.current || document.hidden) element.pause(); setNotice(''); }
    catch { setNotice('Playback could not start. Try again.'); }
  }
  function seek(value: number) { if (media.current && duration && allowed.current) { media.current.currentTime = value; setProgress(value); } }
  const mediaProps = {
    src: post.media.src, loop: true, preload: 'metadata', muted,
    onPlay: () => { if (!allowed.current || document.hidden) media.current?.pause(); else setPlaying(true); },
    onPause: () => { setPlaying(false); setBuffering(false); }, onPlaying: () => { setBuffering(false); setNotice(''); },
    onWaiting: () => setBuffering(true), onCanPlay: () => setBuffering(false),
    onLoadedMetadata: () => { const element = media.current; if (element) { element.volume = volume; if (Number.isFinite(element.duration)) element.currentTime = Math.min(progress, element.duration); } },
    onTimeUpdate: () => setProgress(media.current?.currentTime ?? 0),
    onDurationChange: () => { const value = media.current?.duration ?? 0; if (Number.isFinite(value) && value > 0) setDuration(value); },
    onError: () => { setFailed(true); setPlaying(false); setBuffering(false); },
  };
  const played = duration ? Math.min(1, progress / duration) : 0;
  const controls =
    <div className="discovery-media-controls">
      <div className={`discovery-seek ${wave ? 'has-waveform' : ''}`} style={{ '--played': `${played * 100}%` } as CSSProperties}>
        {wave && <WaveformProgress data={wave} progress={played} />}
        <input type="range" min={0} max={duration || 1} step={.1} value={Math.min(progress, duration || 1)} aria-label={`Seek ${post.title}`} aria-valuetext={`${time(progress)} of ${time(duration)}`} disabled={!duration || failed || !active || blocked} onChange={event => seek(Number(event.target.value))} />
      </div>
      <MediaPlaybackControls title={post.title} playing={playing} muted={muted} volume={volume} progress={progress} duration={duration} disabled={failed || !active || blocked} onToggle={toggle} onMute={() => { if (muted && volume === 0) { if (media.current) media.current.volume = 1; setVolume(1); } setMuted(value => !value); }} onVolume={value => { if (media.current) media.current.volume = value; setVolume(value); setMuted(value === 0); }} />
      <div className="discovery-media-status" role="status">
        {failed ? <><span>Media unavailable.</span><button onClick={() => { setFailed(false); setNotice(''); media.current?.load(); }}>Retry playback</button></> : buffering ? 'Buffering…' : notice || (audio && waveformAccess && waveform.isFetching ? 'Loading waveform…' : audio && !wave ? waveformAccess && waveform.isError ? 'Waveform unavailable · audio timeline' : 'Audio timeline' : wave && !wave.hasAudio ? 'No audio track' : '')}
      </div>
    </div>;
  return <div className={`discovery-media ${audio ? 'is-audio' : 'is-video'}`}>
    {audio ? <><AudioDiscoveryCard post={post} info={info} controls={controls} onProjectNavigate={() => media.current?.pause()} />{nearby && <audio {...mediaProps} ref={element => { media.current = element; }} aria-label={`${post.title} audio`} />}</>
      : <><VideoDiscoveryPlayer>{nearby ? <video {...mediaProps} ref={element => { media.current = element; }} poster={post.coverUrl ?? undefined} playsInline className="discovery-video" aria-label={`${post.title} video`} /> : post.coverUrl ? <img src={post.coverUrl} alt="" loading="lazy" className="discovery-video" /> : <Disc3 aria-hidden="true" size={48} />}</VideoDiscoveryPlayer>{controls}{info}</>}
  </div>;
});

export function MediaPlaybackControls({ title, playing, muted, volume, progress, duration, disabled, onToggle, onMute, onVolume }: {
  title: string; playing: boolean; muted: boolean; volume: number; progress: number; duration: number; disabled: boolean;
  onToggle: () => void; onMute: () => void; onVolume: (value: number) => void;
}) {
  return <div className="discovery-playback">
    <button className="discovery-control" aria-label={`${playing ? 'Pause' : 'Play'} ${title}`} disabled={disabled} onClick={onToggle}>{playing ? <Pause size={20} /> : <Play size={20} />}</button>
    <span className="discovery-time">{time(progress)} <span>/ {time(duration)}</span></span>
    <div className="discovery-volume"><button className="discovery-control" aria-label={`${muted ? 'Unmute' : 'Mute'} ${title}`} aria-pressed={muted} disabled={disabled} onClick={onMute}>{muted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
      <input type="range" aria-label={`Volume ${title}`} min="0" max="1" step=".05" value={muted ? 0 : volume} disabled={disabled} onChange={event => onVolume(Number(event.target.value))} />
    </div>
  </div>;
}
