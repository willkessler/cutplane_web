/**
 * Physical input → the original's logical actions (controls.h), so nothing
 * downstream sees devices. Each profile is a pure mapping from what is
 * held (buttons, modifier keys) to the active quasimode; quasimodes are
 * spring-loaded, lasting exactly as long as the key or button is held.
 */

export type Profile = 'trackpad' | 'three-button' | 'two-button';

export const PROFILES: { id: Profile; label: string }[] = [
  { id: 'trackpad', label: 'Trackpad / one button' },
  { id: 'three-button', label: 'Three-button mouse' },
  { id: 'two-button', label: 'Two-button mouse' },
];

/** DOM `buttons` bits. */
export const LEFT = 1;
export const RIGHT = 2;
export const MIDDLE = 4;

export interface Held {
  buttons: number;
  alt: boolean;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
}

export const NOTHING_HELD: Held = {
  buttons: 0,
  alt: false,
  meta: false,
  ctrl: false,
  shift: false,
};

/** What pointer motion does right now. */
export type Motion = 'point' | 'plane' | 'rotate';

export function motionFor(profile: Profile, h: Held): Motion {
  switch (profile) {
    case 'trackpad':
      // ⌘ + move rotates the room, ⌥ + move pushes the plane; no click needed under pointer lock.
      if (h.meta) return 'rotate';
      if (h.alt) return 'plane';
      return 'point';
    case 'three-button':
      // The SGI bindings: middle drags the plane, right rotates the room.
      if (h.buttons & RIGHT) return 'rotate';
      // Middle with left held is the carry chord: the plane moves and takes the drag with it.
      if (h.buttons & MIDDLE) return 'plane';
      if (h.alt) return 'plane';
      return 'point';
    case 'two-button':
      if (h.buttons & RIGHT) return 'rotate';
      if (h.alt) return 'plane';
      return 'point';
  }
}

/** Default profile for a platform: Macs get the trackpad bindings. */
export function defaultProfile(platform: string): Profile {
  return /mac/i.test(platform) ? 'trackpad' : 'two-button';
}

/** The keyboard commands live in M2 (controls.c's, restored), plus the work-mode toggle. */
export type Command =
  | 'planeJump'
  | 'rotateLeft'
  | 'rotateRight'
  | 'rotateUp'
  | 'rotateDown'
  | 'resetView'
  | 'workMode'
  | 'undo'
  | 'redo';

export function commandFor(code: string, h: Held): Command | undefined {
  // Undo and redo are new (the original's U key did nothing): ⌘Z / ⇧⌘Z, or Ctrl on other systems.
  if ((h.meta || h.ctrl) && code === 'KeyZ') return h.shift ? 'redo' : 'undo';
  if (h.ctrl && code === 'KeyY') return 'redo';
  if (h.meta || h.ctrl) return undefined; // leave the other ⌘/Ctrl combinations to the browser
  switch (code) {
    case 'Space':
      return 'planeJump';
    case 'ArrowLeft':
      return 'rotateLeft';
    case 'ArrowRight':
      return 'rotateRight';
    case 'ArrowUp':
      return 'rotateUp';
    case 'ArrowDown':
      return 'rotateDown';
    case 'Digit0':
    case 'Home':
      return 'resetView';
    case 'KeyF':
    case 'Enter':
      return 'workMode';
    default:
      return undefined;
  }
}

/** Human-readable bindings for the help line. */
export function bindingHints(profile: Profile): string[] {
  const common = [
    'Click: pick',
    'Drag: move what is picked',
    'Shift-click: add or remove',
    'Ctrl: one axis',
    'Scroll: plane depth',
    'Space: plane jump',
    '← → ↑ ↓: rotate 10°',
    '0: reset view',
    '⌘Z / ⇧⌘Z: undo / redo',
  ];
  switch (profile) {
    case 'trackpad':
      return [
        'Move: crosshair',
        'Hold ⌥ + move: plane depth',
        'Hold ⌘ + move: rotate room',
        ...common,
      ];
    case 'three-button':
      return ['Move: crosshair', 'Middle-drag: plane depth', 'Right-drag: rotate room', ...common];
    case 'two-button':
      return [
        'Move: crosshair',
        'Hold ⌥ + move: plane depth',
        'Right-drag: rotate room',
        ...common,
      ];
  }
}
