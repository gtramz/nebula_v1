import { professionalIdentityUpdate, validateArtistProfileKeys } from '../lib/local/src/artist-identity.js';
import type { ArtistProfileInput } from '../lib/local/src/store.js';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function ensure(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
export function object(value: unknown): Record<string, unknown> {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected an object.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, name: string, max: number, min = 0): string {
  ensure(typeof value === 'string', `${name} must be text.`);
  const result = value.trim();
  ensure(result.length >= min && result.length <= max, `${name} must contain ${min}–${max} characters.`);
  return result;
}
export function id(value: unknown): number {
  ensure(typeof value === 'number' && Number.isSafeInteger(value) && value > 0, 'Invalid ID.'); return value;
}
export function bool(value: unknown): boolean { ensure(typeof value === 'boolean', 'Choose a valid permission.'); return value; }
export function credentials(value: unknown, registration = false) {
  const data = object(value);
  const email = text(data.email, 'Email', 254, 3).toLowerCase();
  ensure(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter a valid email.');
  ensure(typeof data.password === 'string' && data.password.length >= (registration ? 8 : 1) && data.password.length <= 128, 'Enter a password of 8–128 characters.');
  return { email, password: data.password };
}
export function profile(value: unknown) {
  const data = object(value);
  validateArtistProfileKeys(data);
  const result: ArtistProfileInput = { name: text(data.name, 'Name', 120, 2), ...professionalIdentityUpdate(data) };
  for (const [key, max] of [['genre', 120], ['basedIn', 120], ['recordLabel', 120], ['bio', 4000], ['picture', 1_000_000]] as const) {
    if (data[key] !== undefined) result[key] = data[key] === null ? null : text(data[key], key, max);
  }
  return result;
}
export function project(value: unknown) {
  const data = object(value);
  const result: Record<string, unknown> = {};
  for (const [name, max] of Object.entries({ title: 160, category: 60, subcategory: 60, format: 60, pitch: 4000, story: 12000, coverUrl: 1_000_000, returnModel: 400, targetReleaseDate: 100, status: 20, currency: 3 })) {
    if (data[name] !== undefined) result[name] = data[name] === null ? null : text(data[name], name, max);
  }
  if (data.goalAmount !== undefined) { ensure(typeof data.goalAmount === 'number', 'Enter a funding goal.'); result.goalAmount = data.goalAmount; }
  if (data.useOfFunds !== undefined) {
    ensure(Array.isArray(data.useOfFunds) && data.useOfFunds.length <= 20, 'Check use of funds.');
    result.useOfFunds = data.useOfFunds.map(value => {
      const item = object(value); ensure(typeof item.percentage === 'number', 'Check percentage.');
      return { label: text(item.label, 'Label', 120, 1), percentage: item.percentage };
    });
  }
  return result;
}
export function sniffMedia(header: Buffer): { kind: 'audio' | 'video' | 'image' | 'document' | 'archive'; mime: string } | null {
  if (header.toString('ascii', 0, 5) === '%PDF-') return { kind: 'document', mime: 'application/pdf' };
  if (header.subarray(0, 4).equals(Buffer.from([80,75,3,4])) || header.subarray(0, 4).equals(Buffer.from([80,75,5,6]))) return { kind: 'archive', mime: 'application/zip' };
  if (header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { kind: 'image', mime: 'image/png' };
  if (header[0] === 255 && header[1] === 216 && header[2] === 255) return { kind: 'image', mime: 'image/jpeg' };
  if (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp' };
  if (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WAVE') return { kind: 'audio', mime: 'audio/wav' };
  if (header.toString('ascii', 0, 3) === 'ID3' || (header[0] === 255 && (header[1] & 0xe0) === 0xe0)) return { kind: 'audio', mime: 'audio/mpeg' };
  if (header.toString('ascii', 0, 4) === 'OggS') return { kind: 'audio', mime: 'audio/ogg' };
  if (header.toString('ascii', 4, 8) === 'ftyp') return { kind: 'video', mime: 'video/mp4' };
  if (header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { kind: 'video', mime: 'video/webm' };
  return null;
}
