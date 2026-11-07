import type { RemixInput } from '@nebula/local';

export function wav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels, samples = buffer.length, bytes = new ArrayBuffer(44 + samples * channels * 2), view = new DataView(bytes);
  const word = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, samples * channels * 2, true);
  const data = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
  let peak = 1;
  for (const channel of data) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  for (let i = 0; i < samples; i++) for (let c = 0; c < channels; c++) {
    const sample = data[c][i] / peak;
    view.setInt16(44 + (i * channels + c) * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

export async function decodeAudio(blob: Blob, maxSeconds: number, recorded = false): Promise<AudioBuffer> {
  if (blob.size > 25 * 1024 * 1024) throw new Error('Choose audio up to 25 MB.');
  // Bound decoded memory before allocating PCM. Recorder blobs can lack duration
  // metadata; those are already bounded by the studio's 60-second recording timer.
  if (!recorded) {
    const url = URL.createObjectURL(blob), audio = new Audio();
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { audio.onloadedmetadata = null; audio.onerror = null; reject(new Error('Could not read audio duration. Export as WAV or MP3.')); }, 15_000);
        audio.onloadedmetadata = () => { clearTimeout(timer); Number.isFinite(audio.duration) && audio.duration > .1 && audio.duration <= maxSeconds ? resolve() : reject(new Error(`Choose audio between 0.1 and ${maxSeconds} seconds with duration metadata.`)); };
        audio.onerror = () => { clearTimeout(timer); reject(new Error('This audio format cannot be played. Try WAV or MP3.')); };
        audio.preload = 'metadata'; audio.src = url;
      });
    } finally { audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); }
  }
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    if (!Number.isFinite(audio.duration) || audio.duration <= .1 || audio.duration > maxSeconds) throw new Error(`Choose audio between 0.1 and ${maxSeconds} seconds.`);
    return audio;
  } finally { await context.close(); }
}

export async function renderMix(base: AudioBuffer, voice: AudioBuffer, settings: RemixInput): Promise<Blob> {
  const duration = settings.endSeconds - settings.startSeconds;
  if (!Number.isFinite(duration) || duration < .1 - 1e-9 || duration > 60 + 1e-9 || settings.startSeconds < 0 || settings.endSeconds > base.duration + .001 || settings.voiceOffset < 0 || settings.voiceOffset >= duration) throw new Error('Check the fragment and your audio start time.');
  const context = new OfflineAudioContext(2, Math.ceil(duration * 44100), 44100);
  const track = (buffer: AudioBuffer, gain: number, at: number, offset: number, length: number) => {
    const source = context.createBufferSource(), volume = context.createGain(); source.buffer = buffer; volume.gain.value = gain;
    source.connect(volume).connect(context.destination); source.start(at, offset, length);
  };
  track(base, settings.baseGain, 0, settings.startSeconds, duration);
  track(voice, settings.voiceGain, settings.voiceOffset, 0, Math.min(voice.duration, duration - settings.voiceOffset));
  return wav(await context.startRendering());
}

/** Canonical editable audio track: bounded stereo PCM, independent of recorder container. */
export async function editableAudio(buffer: AudioBuffer): Promise<{ audio: AudioBuffer; blob: Blob }> {
  const context = new OfflineAudioContext(2, Math.ceil(buffer.duration * 44100), 44100);
  const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.start();
  const audio = await context.startRendering();
  const blob = wav(audio);
  // Preview the same quantized/normalized track that will be restored after reload.
  return { audio: await decodeAudio(blob, 120, true), blob };
}
