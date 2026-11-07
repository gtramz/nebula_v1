export type Fragment = { start: number; end: number };
export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
const rounded = (value: number) => Math.round(value * 1000) / 1000;
export function initialFragment(length: number): Fragment {
  return { start: 0, end: length >= 30 ? 30 : length >= 15 ? 15 : length };
}
export function fixedFragment(start: number, duration: number, length: number): Fragment {
  const size = Math.min(duration, length), next = rounded(clamp(start, 0, length - size));
  return { start: next, end: Math.min(length, rounded(next + size)) };
}
export function clipDurations(length: number) { return [15, 30, 60].filter(value => value <= length); }
export function nextClipDuration(duration: number, length: number) {
  const choices = clipDurations(length);
  return choices.find(value => value > duration + .001) ?? choices[0] ?? length;
}
export function timeLabel(value: number) { const ms = Math.round(Math.max(0, value) * 1000); return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2,'0')}.${String(ms % 1000).padStart(3,'0').slice(0,2)}`; }
