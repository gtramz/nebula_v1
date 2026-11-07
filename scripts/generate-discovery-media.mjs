// Original abstract visuals and synthesized tones; no external recordings/assets.
// Run manually with: node scripts/generate-discovery-media.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = new URL('../artifacts/nebula/public/discovery-demo/', import.meta.url);
await mkdir(directory, { recursive: true });
function makeAudio(notes) {
  const rate = 22050, seconds = 8, samples = rate * seconds;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const fade = Math.min(t / .4, 1, (seconds - t) / .8);
    const value = notes.reduce((sum, f, n) => sum + Math.sin(t * f * Math.PI * 2) * (.7 + .3 * Math.sin(t * (n + 1))), 0) / notes.length;
    wav.writeInt16LE(Math.round(value * fade * 4500), 44 + i * 2);
  }
  return wav;
}
await writeFile(new URL('soft-signal.wav', directory), makeAudio([164.81, 207.65, 246.94, 329.63]));
await writeFile(new URL('orbit.wav', directory), makeAudio([130.81, 196, 261.63, 311.13]));

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 540; canvas.height = 800;
    const ctx = canvas.getContext('2d');
    const audio = new AudioContext();
    await audio.resume();
    const destination = audio.createMediaStreamDestination();
    [130.81, 164.81, 196].forEach(frequency => {
      const oscillator = audio.createOscillator(), gain = audio.createGain();
      oscillator.frequency.value = frequency; gain.gain.value = .035;
      oscillator.connect(gain).connect(destination); oscillator.start();
    });
    const stream = canvas.captureStream(24);
    destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 550000 });
    const chunks = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const done = new Promise(resolve => { recorder.onstop = async () => resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()))); });
    const start = performance.now();
    const draw = () => {
      const t = (performance.now() - start) / 1000;
      ctx.fillStyle = '#061317'; ctx.fillRect(0, 0, 540, 800);
      const gradient = ctx.createRadialGradient(270 + Math.sin(t) * 35, 340, 10, 270, 340, 290);
      gradient.addColorStop(0, '#86f4ee'); gradient.addColorStop(.22, '#14a6ba'); gradient.addColorStop(.52, '#063c50'); gradient.addColorStop(1, '#061317');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 540, 800);
      ctx.save(); ctx.translate(270, 340); ctx.rotate(t * .07 - .5);
      for (let i = 0; i < 36; i++) {
        ctx.strokeStyle = `rgba(183,255,251,${.09 + .1 * Math.sin(i / 5 + t)})`;
        ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(0, 0, 70 + i * 4, 25 + i * 4, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      for (let i = 0; i < 65; i++) {
        const x = (i * 97) % 540, y = (i * 137 + t * (i % 3 + 1) * 4) % 800;
        ctx.fillStyle = `rgba(211,249,255,${.12 + (i % 4) * .08})`; ctx.fillRect(x, y, 1, 1);
      }
    };
    draw(); const timer = setInterval(draw, 1000 / 24);
    recorder.start();
    await new Promise(resolve => setTimeout(resolve, 8000));
    recorder.stop(); clearInterval(timer);
    const result = await done;
    stream.getTracks().forEach(track => track.stop()); await audio.close();
    return result;
  });
  await writeFile(new URL('after-hours.webm', directory), Buffer.from(bytes));
} finally { await browser.close(); }
console.log('Discovery demo media generated.');
