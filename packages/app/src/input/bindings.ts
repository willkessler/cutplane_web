import type { KeysLine } from '@cutplane/behaviors';

/**
 * Physical input → the original's logical actions (controls.h), so nothing
 * downstream sees devices. A pure mapping from what is held (buttons, modifier
 * keys) to the active quasimode; quasimodes are spring-loaded, lasting exactly
 * as long as the key or button is held. One mapping serves a trackpad, a
 * two-button and a three-button mouse alike (a browser can't tell them apart):
 * none of their bindings conflict.
 */

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

export function motionFor(h: Held): Motion {
  // ⌘ + move (a trackpad needs no click under pointer lock), or the right button: the room.
  if (h.meta || h.buttons & RIGHT) return 'rotate';
  // ⌥ + move, or the SGI's middle button: the plane. Middle with left held is the carry
  // chord: the plane moves and takes the drag with it.
  if (h.alt || h.buttons & MIDDLE) return 'plane';
  return 'point';
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
  | 'redo'
  | 'duplicate'
  | 'delete'
  | 'selectAll'
  | 'rotateTool'
  | 'group'
  | 'slice'
  | 'union'
  | 'zoomTool'
  | 'panTool'
  | 'pencilTool'
  | 'measureTool'
  | 'gravityTool'
  | 'display'
  | 'help';

export function commandFor(code: string, h: Held): Command | undefined {
  // Undo and redo are new (the original's U key did nothing): ⌘Z / ⇧⌘Z, or Ctrl on other systems.
  if ((h.meta || h.ctrl) && code === 'KeyZ') return h.shift ? 'redo' : 'undo';
  if (h.ctrl && code === 'KeyY') return 'redo';
  // New: ⌘A / Ctrl+A picks everything in the world (then Delete clears it).
  if ((h.meta || h.ctrl) && code === 'KeyA') return 'selectAll';
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
    case 'KeyD':
      return 'duplicate';
    case 'KeyR':
      return 'rotateTool';
    // controls.h: G groups (or ungroups), \ slices what is picked, Z brings the
    // magnifier to the crosshair. New here: H brings the pan tool (the hand; P
    // there), P the pencil.
    case 'KeyG':
      return 'group';
    case 'Backslash':
      return 'slice';
    // New here: B unions what is picked (the original's BOOLEANBUTTON, a test hook).
    case 'KeyB':
      return 'union';
    case 'KeyZ':
      return 'zoomTool';
    case 'KeyH':
      return 'panTool';
    case 'KeyP':
      return 'pencilTool';
    // New: M brings the ruler (the measure pad comes with it).
    case 'KeyM':
      return 'measureTool';
    // New: V brings the globe (gravity).
    case 'KeyV':
      return 'gravityTool';
    // New: 1 steps through how the rest is drawn (as wire, out of sight) and back.
    case 'Digit1':
      return 'display';
    // New: ? (shifted or not) shows the keys plate, as the help pad does, or puts it away.
    case 'Slash':
      return 'help';
    case 'Backspace':
    case 'Delete':
      return 'delete';
    default:
      return undefined;
  }
}

/**
 * The keys plate's lines (new: the help pad's plate, on the plane's side, so nothing
 * flat is laid over the room): headed groups of a key, or a tool, and what it does,
 * in the Hershey font's plain ASCII.
 */
export function keyLines(mac: boolean): KeysLine[] {
  const cmd = mac ? 'Cmd' : 'Ctrl';
  const alt = mac ? 'Opt' : 'Alt';
  return [
    { heading: 'The plane' },
    [`${alt} + move`, 'push it in depth'],
    ['Scroll, swipe', 'push it in depth'],
    ['Middle-drag', 'push it in depth'],
    ['Space', 'jump to the walls'],
    { heading: 'The view' },
    ...(mac ? [['Cmd + move', 'turn the room'] as const] : []),
    ['Right-drag', 'turn the room'],
    ['Arrows', 'turn it 10 degrees'],
    ['0', 'face the room again'],
    ['1', 'others: wire, hidden'],
    ['F, Esc', 'full screen, leave it'],
    ['?', 'these keys, or not'],
    { heading: 'Picking and moving' },
    ['Click', 'pick an item or part'],
    ['Shift-click', 'pick more, or unpick'],
    [`${cmd}-A`, 'pick everything'],
    ['Drag', 'move what is picked'],
    [`${alt} + drag`, 'carry it in depth too'],
    ['Hold Ctrl', 'keep to one axis'],
    { heading: 'Changing what is picked' },
    ['D', 'duplicate it'],
    ['Delete', 'delete it'],
    ['G', 'group or ungroup it'],
    ['B', 'union it'],
    ['\\', 'slice it at the plane'],
    [`${cmd}-Z`, 'undo'],
    [`Shift-${cmd}-Z`, 'redo'],
    { heading: 'Tools: the rails, top left' },
    ['R', 'rotate tool'],
    ['Z', 'magnifier; 2-click: fit'],
    ['H', 'pan hand: move it all'],
    ['P', 'pencil: draw, split faces'],
    ['M', 'ruler: measure'],
    ['V', 'globe: drop things'],
    ['Saw', 'cut in two at the plane'],
    ['Drill', 'cut with a red copy'],
    ['Magnet', 'snap face to face'],
    ['Grabber', 'pick objects whole'],
    ['Key again', 'put the tool away'],
    ['Esc', 'puts it away too'],
    { heading: 'Goodies and files' },
    ['2-click', 'put a goody back'],
    ['Floppy', 'load, save by name'],
    ['Top bar', 'open, save, export'],
  ];
}
