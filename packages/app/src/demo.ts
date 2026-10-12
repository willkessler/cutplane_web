/**
 * The README animation: a scripted session that moves the way a person
 * would — one thing at a time. Point at the model, push the plane in,
 * turn the room a little, push the plane again, turn back the other way,
 * and so on. Never rotating and sectioning at once. Then it takes hold of
 * a face on the equator of the command module's sphere through the
 * section, pulls it out, pushes it back home (where its neighbours merge
 * flat again). Last, R brings the rotate tool to the sphere, a slide along
 * its bar rolls the module and back, R on the tool's centre puts it away,
 * a click on the toolpads' headpad opens its rail and the drill comes off
 * its pad. Pressed on the module, it makes a red copy of it (the cutter);
 * carried across and let go over the module, the cutter takes a bite out
 * of it. A turn of the room shows the bite, undo puts the module back
 * whole, a click closes the rail, and a click on nothing lets go.
 */
export interface Pose {
  x: number;
  y: number;
  /** Plane depth as a fraction of the model's depth: 0 = in front of it, 1 = behind it. */
  depth: number;
  yaw: number;
  pitch: number;
  /** The Pick button is held. */
  pressed: boolean;
  /** How many times R (rotate tool) has been pressed so far. */
  rotateKeys: number;
  /** How many times ⌘Z (undo) has been pressed so far. */
  undoKeys: number;
}

type Key = Exclude<keyof Pose, 'pressed' | 'rotateKeys' | 'undoKeys'>;
/** `press`, `rotateKey` and `undoKey` take effect when the step starts. */
type Step = {
  seconds: number;
  to?: Partial<Pick<Pose, Key>>;
  press?: boolean;
  rotateKey?: true;
  undoKey?: true;
};

const START: Pose = {
  x: 260,
  y: -170,
  depth: 0,
  yaw: 0,
  pitch: 12,
  pressed: false,
  rotateKeys: 0,
  undoKeys: 0,
};

/** A face on the equator of the lower ship's sphere, with the plane through its middle. */
const GRAB = { x: -186, y: -150, depth: 0.055 };
/** The toolpads' headpad (toolpads.rsc), riding the plane top left. */
const HEADPAD = { x: -385, y: 320 };
/** Inside the sphere's section at that depth: the rotate tool goes here. */
const PIVOT = { x: -110, y: -130 };
/** The drill's pad, third on the toolpads' rail once it is open. */
const DRILL = { x: -389, y: 34 };

const SCRIPT: Step[] = [
  { seconds: 0.8 },
  { seconds: 1.4, to: { x: 40, y: -10 } }, // bring the crosshair over the model
  { seconds: 0.4 },
  { seconds: 2.4, to: { depth: 0.45 } }, // push the plane in
  { seconds: 0.6 },
  { seconds: 2.2, to: { yaw: 24 } }, // turn the room to look along the cut
  { seconds: 0.5 },
  { seconds: 2.0, to: { depth: 0.7 } }, // deeper
  { seconds: 0.6 },
  { seconds: 3.2, to: { yaw: -24 } }, // and around the other way
  { seconds: 0.5 },
  { seconds: 2.0, to: { depth: 0.3 } }, // pull the plane back toward you
  { seconds: 0.6 },
  { seconds: 2.0, to: { yaw: 0 } },
  { seconds: 0.4 },
  { seconds: 1.0, to: { depth: GRAB.depth } }, // set the plane through the sphere
  { seconds: 0.4 },
  { seconds: 1.6, to: { x: GRAB.x, y: GRAB.y } }, // point at a face on its section
  { seconds: 0.5 },
  { seconds: 0.3, press: true }, // take hold of it
  { seconds: 2.4, to: { x: GRAB.x - 120, y: GRAB.y + 50 } }, // pull it out
  { seconds: 0.9 },
  { seconds: 2.2, to: { x: GRAB.x, y: GRAB.y } }, // and push it back home
  { seconds: 0.4, press: false },
  { seconds: 1.0, to: PIVOT }, // into the sphere
  { seconds: 0.5 },
  { seconds: 0.8, rotateKey: true }, // R: the rotate tool comes, and the module is picked
  { seconds: 0.9, to: { x: PIVOT.x + 50 } }, // onto the horizontal bar
  { seconds: 0.3, press: true },
  { seconds: 2.4, to: { x: PIVOT.x + 115 } }, // slide along it: the module rolls
  { seconds: 0.7 },
  { seconds: 2.4, to: { x: PIVOT.x + 50 } }, // and back
  { seconds: 0.3, press: false },
  { seconds: 0.8, to: PIVOT }, // to the tool's centre
  { seconds: 0.5, rotateKey: true }, // R again: the tool goes back to its corner
  { seconds: 1.6, to: HEADPAD }, // up to the toolpads' headpad, in the plane
  { seconds: 0.3 }, // (settle before clicking, as a hand does)
  { seconds: 0.2, press: true }, // a click opens its rail (headpad.cpl)
  { seconds: 1.0, press: false }, // pencil, saw and drill, on their pads
  { seconds: 1.2, to: DRILL }, // to the drill's pad
  { seconds: 0.3 },
  { seconds: 0.2, press: true }, // a click: the drill comes off it, onto the crosshair
  { seconds: 0.5, press: false },
  { seconds: 1.8, to: PIVOT }, // carry it to the module, the plane through it
  { seconds: 0.5 },
  { seconds: 0.6, press: true }, // press: a red copy of the module, the cutter (drill.cpl)
  { seconds: 2.4, to: { x: PIVOT.x + 60 } }, // carry the cutter across the module
  { seconds: 0.6 },
  { seconds: 0.8, press: false }, // let go: it takes a bite out of the module (CPBOOLEAN)
  { seconds: 2.2, to: { yaw: 32 } }, // turn the room to look at the bite
  { seconds: 1.2 },
  { seconds: 2.0, to: { yaw: 0 } }, // and back
  { seconds: 0.6, undoKey: true }, // ⌘Z: the module is whole again
  { seconds: 1.6, to: HEADPAD },
  { seconds: 0.3 },
  { seconds: 0.2, press: true }, // a click closes the rail
  { seconds: 0.4, press: false },
  { seconds: 1.6, to: { depth: 0, x: 260, y: -170 } }, // and out
  { seconds: 0.3 },
  { seconds: 0.2, press: true }, // a click on nothing lets go of the face, ready to loop
  { seconds: 0.4, press: false },
];

export const DEMO_SECONDS = SCRIPT.reduce((s, x) => s + x.seconds, 0);

const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));

export function demoPose(t: number): Pose {
  let time = ((t % DEMO_SECONDS) + DEMO_SECONDS) % DEMO_SECONDS;
  const pose = { ...START };
  for (const step of SCRIPT) {
    if (step.press !== undefined) pose.pressed = step.press;
    if (step.rotateKey) pose.rotateKeys++;
    if (step.undoKey) pose.undoKeys++;
    const u = Math.min(1, time / step.seconds);
    if (step.to)
      for (const k of Object.keys(step.to) as Key[]) pose[k] += (step.to[k]! - pose[k]) * ease(u);
    if (time <= step.seconds) break;
    time -= step.seconds;
  }
  return pose;
}
