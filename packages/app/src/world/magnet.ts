import { groupRoot, mat4, subtree, type CutObject, type Mat4 } from '@cutplane/kernel';
import { T, type Feature } from '@cutplane/cpl';
import { isSub, type Runtime, type Sub, type V3 } from '@cutplane/behaviors';

/**
 * New here: the magnet shows where it will snap. Taken by a face, what it drags
 * stays on the crosshair where it was taken (it passes through anything). The face
 * of another object under the crosshair, through the section, is highlighted as a
 * face is to be picked, and a ghost of what is dragged shows it there: the face
 * taken turned flush onto it, the point taken on the point highlighted. Moved on,
 * the ghost goes, or goes to the next face; let go with a ghost showing, what was
 * dragged goes to it; with none, it stays where it is let go.
 */
export class Magnet {
  /** The face the magnet took hold of, if it took a face. */
  private grabbed: Sub | null = null;
  /** Where on it, in its object's own coordinates. */
  private taken: V3 = [0, 0, 0];
  /** The face it would snap to now, and where on it. */
  target: { face: Sub; at: V3 } | null = null;
  /** The world move that would put what is dragged there (the ghost's). */
  ghost: Mat4 | null = null;

  constructor(private readonly rt: Runtime) {}

  /** A press with the magnet on what was selectable: by a face, it snaps by that face. */
  grab(selectable: readonly Feature[]): void {
    const subs = selectable.filter(isSub);
    const g = subs.length > 0 && subs.every((f) => f.type === T.Fve) ? subs[0]! : null;
    this.grabbed = g;
    this.target = this.ghost = null;
    if (g) this.taken = point(this.rt.selectableOf(g.object).at, g.object.invXform);
  }

  /** The magnet is put down: nothing is held by it. */
  forget(): void {
    this.grabbed = this.target = this.ghost = null;
  }

  /** What is dragged, whole (for the ghost), while it's dragged by a face. */
  dragged(): CutObject | null {
    return this.grabbed && this.ghost ? groupRoot(this.grabbed.object) : null;
  }

  /** Each frame of a drag: the face under the crosshair, and the ghost on it. */
  update(): void {
    const g = this.grabbed;
    this.target = this.ghost = null;
    if (!g || !this.rt.features.alive(g)) return;
    const root = groupRoot(g.object);
    const own = new Set(subtree(root));
    const target = this.rt.faceUnder((o) => own.has(o));
    if (!target) return;
    const about = point(this.taken, g.object.xform);
    const m = this.rt.faceSnap(g, target.face, about, target.at);
    if (!m) return;
    this.target = target;
    this.ghost = m;
  }

  /**
   * The release: what was dragged goes to the ghost, if one shows. (Not through
   * magnetic.cpl's release, which snaps only if a face is under the crosshair then;
   * what was dragged is under it, whole.)
   */
  release(): void {
    const g = this.grabbed;
    if (g && this.ghost && this.rt.features.alive(g))
      this.rt.transformBranch(groupRoot(g.object), this.ghost);
    this.target = this.ghost = null;
  }

  /** Runtime.magnetSnap: taken by a face, the release has been seen to (the ghost, or nothing). */
  readonly snap = (source: Feature): boolean => {
    const g = this.grabbed;
    return !!g && isSub(source) && groupRoot(source.object) === groupRoot(g.object);
  };

  /** What the highlights need to tell one ghost from another. */
  key(): string {
    const t = this.target;
    return t ? `${t.face.id}|${t.at.join(',')}|${this.ghost?.join(',')}` : '';
  }
}

const point = (p: readonly number[], m: Mat4): V3 => mat4.transformPoint(m, p[0]!, p[1]!, p[2]!);
