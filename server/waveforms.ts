import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Waveform } from '../lib/local/src/publications.js';
import { ensure, HttpError } from './validation.js';

const VERSION = 1, RATE = 8000, POINTS_PER_SECOND = 20;
const formats = 'wav,mp3,ogg,mov,matroska,webm';
export function mediaTool(name: 'ffmpeg' | 'ffprobe') {
  return process.env[`NEBULA_${name.toUpperCase()}_PATH`] || (existsSync(resolve('.data/tools', name)) ? resolve('.data/tools', name) : name);
}
export function waveforms(directory: string, mediaDirectory: string, timeoutMs = 60_000) {
  const cache = join(directory, 'waveforms'), pending = new Map<string, Promise<Waveform>>();
  let tail: Promise<unknown> = Promise.resolve(), closed = false;
  const children = new Set<ChildProcess>();
  function run(name: 'ffmpeg' | 'ffprobe', args: string[], deadline: number, limit: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (closed || Date.now() >= deadline) { reject(new HttpError(503, 'Waveform generation timed out. Try again.')); return; }
      const child = spawn(mediaTool(name), args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false }); children.add(child);
      const chunks: Buffer[] = []; let size = 0, failure: Error | undefined;
      const timer = setTimeout(() => { failure = new HttpError(503, 'Waveform generation timed out. Try again.'); child.kill('SIGKILL'); }, deadline - Date.now());
      child.stdout!.on('data', (chunk: Buffer) => { size += chunk.length; if (size > limit) { failure = new HttpError(422, 'Waveform output exceeds the processing limit.'); child.kill('SIGKILL'); } else chunks.push(chunk); });
      child.stderr!.resume(); // Drain diagnostics without retaining or exposing file paths.
      child.on('error', () => { failure = new HttpError(503, 'Waveform processor is unavailable.'); });
      child.on('close', code => { clearTimeout(timer); children.delete(child); if (failure) reject(failure); else if (code !== 0) reject(new HttpError(422, 'Waveform could not be generated for this file.')); else resolve(Buffer.concat(chunks)); });
    });
  }
  function valid(value: Waveform, mediaId: string) {
    return value.version === VERSION && value.mediaId === mediaId && Number.isFinite(value.duration) && value.duration >= .1 && value.duration <= 600 && typeof value.hasAudio === 'boolean' && value.pointsPerSecond === POINTS_PER_SECOND && Array.isArray(value.peaks) && value.peaks.length === Math.ceil(value.duration * POINTS_PER_SECOND) && value.peaks.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1);
  }
  const path = (id: string) => join(cache, `${id}-v${VERSION}.json`);
  async function generate(mediaId: string): Promise<Waveform> {
    ensure(!closed, 'Waveform processor is stopping.', 503);
    try { const value: Waveform = JSON.parse(await readFile(path(mediaId), 'utf8')); if (valid(value, mediaId)) return value; } catch { /* A missing or damaged cache is regenerable. */ }
    const file = join(mediaDirectory, mediaId), deadline = Date.now() + Math.min(60_000, Math.max(1, timeoutMs));
    const probe = JSON.parse((await run('ffprobe', ['-v','error','-protocol_whitelist','file,pipe','-format_whitelist',formats,'-show_entries','format=duration,start_time:stream=codec_type,channels,duration,start_time','-of','json',file], deadline, 1024 * 1024)).toString()) as { format?: { duration?: string }; streams?: { codec_type: string; channels?: number; duration?: string }[] };
    const duration = Number(probe.format?.duration ?? Math.max(...(probe.streams ?? []).map(s => Number(s.duration) || 0)));
    ensure(Number.isFinite(duration) && duration >= .1 && duration <= 600, 'Choose an original between 0.1 seconds and 10 minutes.', 422);
    const audio = probe.streams?.find(s => s.codec_type === 'audio'), hasAudio = !!audio;
    const channels = audio?.channels === 1 ? 1 : 2, stride = channels * 2;
    const peaks = new Array<number>(Math.ceil(duration * POINTS_PER_SECOND)).fill(0);
    if (hasAudio) {
      // Preserve stream offsets relative to the container start (including delayed audio in video).
      const pcm = await run('ffmpeg', ['-v','error','-nostdin','-threads','1','-filter_threads','1','-protocol_whitelist','file,pipe','-format_whitelist',formats,'-copyts','-start_at_zero','-i',file,'-map','0:a:0','-vn','-sn','-dn','-af',`aresample=${RATE}:async=1:first_pts=0`,'-ac',String(channels),'-ar',String(RATE),'-t','600','-f','s16le','pipe:1'], deadline, RATE * 4 * 601);
      for (let offset = 0; offset + stride - 1 < pcm.length; offset += stride) {
        const bucket = Math.floor((offset / stride) / (RATE / POINTS_PER_SECOND)); if (bucket >= peaks.length) break;
        peaks[bucket] = Math.max(peaks[bucket], Math.abs(pcm.readInt16LE(offset)) / 32768, channels === 2 ? Math.abs(pcm.readInt16LE(offset + 2)) / 32768 : 0);
      }
      for (let i = 0; i < peaks.length; i++) peaks[i] = Math.round(peaks[i] * 10000) / 10000;
    }
    const result: Waveform = { version: VERSION, mediaId, duration, hasAudio, pointsPerSecond: POINTS_PER_SECOND, peaks };
    ensure(!closed, 'Waveform processor is stopping.', 503);
    await mkdir(cache, { recursive: true, mode: 0o700 });
    const temporary = `${path(mediaId)}.part`; await writeFile(temporary, JSON.stringify(result), { mode: 0o600 }); await rename(temporary, path(mediaId));
    return result;
  }
  return {
    get(mediaId: string) {
      ensure(/^[a-f0-9-]{36}$/.test(mediaId), 'Invalid media.', 400);
      const existing = pending.get(mediaId); if (existing) return existing;
      ensure(pending.size < 8, 'Waveform processor is busy. Try again shortly.', 503);
      const job = tail.then(() => generate(mediaId)); pending.set(mediaId, job);
      tail = job.catch(() => {}); void job.then(() => pending.delete(mediaId), () => pending.delete(mediaId)); return job;
    },
    async remove(mediaId: string) { await pending.get(mediaId)?.catch(() => {}); await unlink(path(mediaId)).catch(() => {}); },
    close() { closed = true; for (const child of children) child.kill('SIGKILL'); },
  };
}
