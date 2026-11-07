import { describe, it, expect } from 'vitest';
import { initialFragment, fixedFragment, clipDurations, nextClipDuration } from './fragment';
describe('fragment invariants', () => {
 it('uses supported presets and whole clips below 15 seconds',()=>{expect(initialFragment(192)).toEqual({start:0,end:30});expect(initialFragment(22)).toEqual({start:0,end:15});expect(initialFragment(8)).toEqual({start:0,end:8});});
 it('moves a fixed window intact at both boundaries and when increasing a preset',()=>{expect(fixedFragment(55,30,70)).toEqual({start:40,end:70});expect(fixedFragment(-9,15,70)).toEqual({start:0,end:15});expect(fixedFragment(40,60,70)).toEqual({start:10,end:70});});
 it('cycles only through durations supported by the source',()=>{expect(nextClipDuration(15,192)).toBe(30);expect(nextClipDuration(30,192)).toBe(60);expect(nextClipDuration(60,192)).toBe(15);expect(nextClipDuration(30,45)).toBe(15);expect(clipDurations(22)).toEqual([15]);expect(clipDurations(8)).toEqual([]);expect(nextClipDuration(8,8)).toBe(8);});
});
