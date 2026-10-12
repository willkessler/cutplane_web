import type { Rgb } from '@cutplane/kernel';
import { ints } from './cut/numbers.ts';

export interface ColorRamp {
  name: string;
  entries: number;
  min: Rgb;
  max: Rgb;
}

/** rsc/cpcolors.rsc: the original's colour definitions (the colour truth for the classic look). */
export interface ColorDefinitions {
  /** "Background Color" → [253, 153, 102], etc. Numeric settings are kept as numbers. */
  settings: Record<string, Rgb | number>;
  ramps: ColorRamp[];
}

export function readColors(text: string): ColorDefinitions {
  const settings: ColorDefinitions['settings'] = {};
  const ramps: ColorRamp[] = [];
  let ramp: ColorRamp | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^([^:]+):(.*)$/);
    if (!m) continue;
    const key = m[1]!.trim();
    const val = m[2]!.trim();
    if (key === 'Ramp Name') {
      ramp = { name: val, entries: 0, min: [0, 0, 0], max: [0, 0, 0] };
      ramps.push(ramp);
    } else if (ramp && key === 'Number of Clut Entries') ramp.entries = Number(val);
    else if (ramp && key.startsWith('Ramp Minimum')) ramp.min = ints(val).slice(0, 3) as Rgb;
    else if (ramp && key.startsWith('Ramp Maximum')) ramp.max = ints(val).slice(0, 3) as Rgb;
    else if (!ramp) {
      const nums = val.split(',').map(Number);
      settings[key] = nums.length === 3 ? (nums as Rgb) : nums[0]!;
    }
  }
  return { settings, ramps };
}

/** The colour of a named ramp at shade t ∈ [0, 1] (0 = darkest), as the original's ramps blend. */
export function rampColor(ramp: ColorRamp, t: number): Rgb {
  const k = Math.min(1, Math.max(0, t));
  return ramp.min.map((lo, i) => Math.round(lo + (ramp.max[i]! - lo) * k)) as Rgb;
}
