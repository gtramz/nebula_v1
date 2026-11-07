import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { waveforms, mediaTool } from '../dist-server/server/waveforms.js';
function wav(seconds, amplitude=0) {
 const count=8000*seconds, b=Buffer.alloc(44+count*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(count*2,40);for(let i=0;i<count;i++)b.writeInt16LE(Math.round(amplitude*32767),44+i*2);return b;
}
async function setup(t) { const dir=await mkdtemp(join(tmpdir(),'nebula-wave-')); const media=join(dir,'media');await mkdir(media);const service=waveforms(dir,media);t.after(async()=>{service.close();await rm(dir,{recursive:true,force:true});});return {dir,media,service}; }
test('real peaks, silence, deduplicated cache, regeneration and removal',async t=>{
 const {dir,media,service}=await setup(t), id=randomUUID();await writeFile(join(media,id),wav(3,.5));
 const first=service.get(id),second=service.get(id);assert.equal(first,second);
 const result=await first;assert.equal(result.duration,3);assert.equal(result.hasAudio,true);assert.equal(result.peaks.length,60);assert.ok(result.peaks.every(n=>Math.abs(n-.5)<.001));
 const cache=join(dir,'waveforms',`${id}-v1.json`),initial=(await stat(cache)).mtimeMs;
 assert.deepEqual(await service.get(id),result);assert.equal((await stat(cache)).mtimeMs,initial);
 await writeFile(cache,'broken');assert.deepEqual(await service.get(id),result);
 await service.remove(id);await assert.rejects(stat(cache));
 const silent=randomUUID();await writeFile(join(media,silent),wav(2));assert.ok((await service.get(silent)).peaks.every(n=>n===0));
 assert.throws(()=>service.get('../secret'));
});
test('video audio keeps its delayed timeline; video without sound stays neutral',async t=>{
 const {media,service}=await setup(t), id=randomUUID(), file=join(media,id);
 execFileSync(mediaTool('ffmpeg'),['-v','error','-f','lavfi','-i','color=c=red:s=64x64:r=10:d=4','-itsoffset','1','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-c:a','aac','-f','mp4',file]);
 const result=await service.get(id);assert.ok(result.duration>=4);assert.ok(result.peaks.slice(0,16).every(n=>n<.001));assert.ok(result.peaks.slice(24,50).every(n=>n>.05));
 const silent=randomUUID();execFileSync(mediaTool('ffmpeg'),['-v','error','-f','lavfi','-i','color=c=blue:s=64x64:r=10:d=2','-an','-c:v','libx264','-f','mp4',join(media,silent)]);
 const none=await service.get(silent);assert.equal(none.hasAudio,false);assert.ok(none.peaks.every(n=>n===0));
});
test('processor failures do not poison queue or leave partial caches',async t=>{
 const {dir,media,service}=await setup(t),bad=randomUUID(),good=randomUUID();await writeFile(join(media,bad),'invalid media');await writeFile(join(media,good),wav(1,.2));
 await assert.rejects(service.get(bad),/could not be generated/);assert.ok((await service.get(good)).peaks.some(n=>n>.19));await assert.rejects(readFile(join(dir,'waveforms',`${bad}-v1.json`)));
 const previous=process.env.NEBULA_FFPROBE_PATH;process.env.NEBULA_FFPROBE_PATH=join(dir,'missing');
 try { await service.remove(good);await assert.rejects(service.get(good),/unavailable/); }finally{if(previous)process.env.NEBULA_FFPROBE_PATH=previous;else delete process.env.NEBULA_FFPROBE_PATH;}
 assert.ok((await service.get(good)).hasAudio);
});

test('a hung processor is killed at the deadline and the queue can recover',async t=>{
 const {dir,media}=await setup(t),id=randomUUID();await writeFile(join(media,id),wav(1));
 const script=join(dir,'slow-probe');await writeFile(script,`#!${process.execPath}\nsetTimeout(()=>{},10000);\n`,{mode:0o700});
 const service=waveforms(dir,media,250),previous=process.env.NEBULA_FFPROBE_PATH;
 process.env.NEBULA_FFPROBE_PATH=script;const start=Date.now();
 try {await assert.rejects(service.get(id),/timed out/);assert.ok(Date.now()-start<2000);}finally{if(previous)process.env.NEBULA_FFPROBE_PATH=previous;else delete process.env.NEBULA_FFPROBE_PATH;}
 assert.equal((await service.get(id)).hasAudio,true);service.close();
});
