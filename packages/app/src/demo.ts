/**
 * The README animation: a scripted session that moves the way a person
 * would — one thing at a time. Point at the model, push the plane in,
 * turn the room a little, push the plane again, turn back the other way,
 * and so on. Never rotating and sectioning at once.
 */
export interface Pose {
  x: number;
  y: number;
  /** Plane depth as a fraction of the model's depth: 0 = in front of it, 1 = behind it. */
  depth: number;
  yaw: number;
  pitch: number;
}

type Key = keyof Pose;
type Step = { seconds: number; to?: Partial<Pose> };

const START: Pose = { x: 260, y: -170, depth: 0, yaw: 0, pitch: 12 };

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
  { seconds: 1.6, to: { depth: 0, x: 260, y: -170 } }, // and out, ready to loop
  { seconds: 0.6 },
];

export const DEMO_SECONDS = SCRIPT.reduce((s, x) => s + x.seconds, 0);

const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));

export function demoPose(t: number): Pose {
  let time = ((t % DEMO_SECONDS) + DEMO_SECONDS) % DEMO_SECONDS;
  const pose = { ...START };
  for (const step of SCRIPT) {
    const u = Math.min(1, time / step.seconds);
    if (step.to)
      for (const k of Object.keys(step.to) as Key[]) pose[k] += (step.to[k]! - pose[k]) * ease(u);
    if (time <= step.seconds) break;
    time -= step.seconds;
  }
  return pose;
}
