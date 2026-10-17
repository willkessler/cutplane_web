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
  | 'measureTool';

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
    case 'Backspace':
    case 'Delete':
      return 'delete';
    default:
      return undefined;
  }
}

/** Human-readable bindings for the help line. */
export function bindingHints(mac: boolean): string[] {
  return [
    'Move: crosshair',
    `Hold ${mac ? '⌥' : 'Alt'} + move, or middle-drag: plane depth`,
    mac ? 'Hold ⌘ + move, or right-drag: rotate room' : 'Right-drag: rotate room',
    'Click: pick',
    'Drag: move what is picked',
    'Shift-click: add or remove',
    '⌘A: pick everything',
    'Ctrl: one axis',
    'Scroll: plane depth',
    'Space: plane jump',
    '← → ↑ ↓: rotate 10°',
    '0: reset view',
    'R: rotate tool here (again on it: put away)',
    'D: duplicate',
    'G: group / ungroup',
    '\\: slice what is picked',
    'B: union what is picked',
    'Z / H / P / M: magnifier / pan tool / pencil / ruler',
    '⌫: delete',
    '⌘Z / ⇧⌘Z: undo / redo',
  ];
}

/** The help plate's lines (in the room, so in the Hershey font's plain ASCII). */
export function helpLines(mac: boolean): { text: string; heading?: boolean }[] {
  const cmd = mac ? 'Cmd' : 'Ctrl';
  return [
    { text: 'The plane cuts what it passes through.  Click ? again to close.', heading: true },
    { text: 'Moving', heading: true },
    { text: 'Move: the crosshair' },
    { text: `Hold ${mac ? 'Option' : 'Alt'} and move, or middle-drag: the plane, in depth` },
    { text: mac ? 'Hold Cmd and move, or right-drag: turn the room' : 'Right-drag: turn the room' },
    { text: 'Scroll: the plane    Space: jump to the back wall, back, the front, back' },
    { text: 'Arrow keys: turn the room 10 degrees    0: face it again' },
    { text: 'Ctrl held: keep to one axis    F: full screen    Esc: leave it' },
    { text: 'Picking and changing', heading: true },
    { text: 'Click: pick a vertex, edge, face or object    Shift-click: add or remove' },
    { text: 'Drag: move what is picked (faces stretch or extrude: see the top bar)' },
    { text: `${cmd}-A: pick everything    D: duplicate    Backspace: delete` },
    { text: 'G: group or ungroup    B: union    \\: slice at the plane' },
    { text: `R: the rotate tool (R on it again puts it away)    ${cmd}-Z: undo` },
    { text: 'Tools (the orange rails, top left: click one open, click a pad)', heading: true },
    { text: 'Pencil: draw a shape in the plane, or edge to edge across a face' },
    { text: 'Saw: cut in two at the plane    Drill: drop a cutter through' },
    { text: 'Magnifier (Z), group, pan (H), magnet, grabber, ruler (M): measure' },
    { text: 'Globe: click on something and it falls to the floor' },
    { text: 'Files', heading: true },
    { text: 'The floppy: load and save by name    Open, Save, Export: the top bar' },
  ];
}
