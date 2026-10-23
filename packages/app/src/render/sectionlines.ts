import * as THREE from 'three';
import { computeSection, type ObjectSection, type WorldGeometry } from '@cutplane/kernel';
import { CLASSIC } from '../viewer/palette.ts';
import { Lines, group } from './lines.ts';
import { standInSection, type Model } from './models.ts';

/** grafx.h's Sectionlinewidth. */
const WIDTH = 3;

export interface SectionStats {
  objects: number;
  loops: number;
  openLoops: number;
  segments: number;
  inPlaneFaces: number;
  inPlaneEdges: number;
}

/**
 * The section line, styled as grafx.c's draw_shell_intersection and
 * set_sectionline_style do:
 *
 * - all of it in dark yellow dots, drawn through everything, so the section
 *   stays visible where geometry in front of the plane hides it;
 * - then, depth-tested, a black line WIDTH + 3 wide under a medium-yellow
 *   core: solid where the cut face faces the viewer, dotted and one pixel
 *   thinner where it faces away;
 * - edges lying in the plane in bright yellow.
 */
export class SectionLines {
  readonly object: THREE.Group;
  /** Each model's section at the current depth (models with no section are absent). */
  sections = new Map<Model, ObjectSection>();
  /** Bumped on every update. */
  version = 0;
  stats: SectionStats = {
    objects: 0,
    loops: 0,
    openLoops: 0,
    segments: 0,
    inPlaneFaces: 0,
    inPlaneEdges: 0,
  };
  private readonly through = new Lines({
    color: CLASSIC.darkYellow,
    width: 1.5,
    dashed: true,
    dash: 4,
    depthTest: false,
    renderOrder: 20,
  });
  private readonly outline = new Lines({ color: CLASSIC.black, width: WIDTH + 3, renderOrder: 21 });
  private readonly backOutline = new Lines({
    color: CLASSIC.black,
    width: WIDTH + 2,
    renderOrder: 21,
  });
  private readonly front = new Lines({
    color: CLASSIC.mediumYellow,
    width: WIDTH,
    renderOrder: 22,
  });
  private readonly back = new Lines({
    color: CLASSIC.mediumYellow,
    width: WIDTH - 1,
    dashed: true,
    dash: 4,
    renderOrder: 22,
  });
  private readonly inPlane = new Lines({ color: CLASSIC.yellow, width: WIDTH, renderOrder: 23 });

  constructor() {
    this.object = group(
      this.through,
      this.outline,
      this.backOutline,
      this.front,
      this.back,
      this.inPlane,
    );
  }

  /** Each geometry's last section (a model only redrawn, not changed, keeps its geometry). */
  private readonly cache = new WeakMap<WorldGeometry, { z: number; s: ObjectSection }>();

  /** Recomputes the section at `z`, styled for an eye at `eye` (room coordinates). */
  update(models: readonly Model[], z: number, eye: THREE.Vector3): void {
    const all: number[] = [];
    const fronts: number[] = [];
    const backs: number[] = [];
    const edges: number[] = [];
    const stats: SectionStats = {
      objects: 0,
      loops: 0,
      openLoops: 0,
      segments: 0,
      inPlaneFaces: 0,
      inPlaneEdges: 0,
    };
    this.sections = new Map();
    this.version++;
    // A moving stand-in's section, straight from its triangles: dotted, as a face turned away is.
    const turning: number[] = [];
    for (const m of models) {
      if (m.object.attrs.props.includes('Sectioninvisible')) continue;
      if (m.moving !== undefined) {
        standInSection(m, z, turning);
        continue;
      }
      let c = this.cache.get(m.world);
      if (c?.z !== z) this.cache.set(m.world, (c = { z, s: computeSection(m.world, z) }));
      const s = c.s;
      this.sections.set(m, s);
      if (s.loops.length === 0 && s.inPlaneEdges.length === 0) continue;
      stats.objects++;
      stats.inPlaneFaces += s.inPlaneFaces.length;
      stats.inPlaneEdges += s.inPlaneEdges.length;
      for (const loop of s.loops) {
        stats.loops++;
        if (!loop.closed) stats.openLoops++;
        const p = loop.points;
        const n = p.length / 3;
        loop.segments.forEach((seg, i) => {
          const j = (i + 1) % n;
          const x0 = p[3 * i]!, y0 = p[3 * i + 1]!, x1 = p[3 * j]!, y1 = p[3 * j + 1]!; // prettier-ignore
          if (x0 === x1 && y0 === y1) return;
          stats.segments++;
          const pts = [x0, y0, z, x1, y1, z];
          all.push(...pts);
          const [nx, ny, nz] = m.world.faceNormal(seg.face);
          const facing =
            nx * (eye.x - (x0 + x1) / 2) + ny * (eye.y - (y0 + y1) / 2) + nz * (eye.z - z) >= 0;
          (facing ? fronts : backs).push(...pts);
        });
      }
      const b = m.object.brep;
      for (const e of s.inPlaneEdges) {
        const [p, q] = b.edgeVertices(e);
        edges.push(m.world.x(p), m.world.y(p), z, m.world.x(q), m.world.y(q), z);
      }
    }
    this.stats = stats;
    this.through.set([...all, ...edges, ...turning]);
    this.outline.set([...fronts, ...edges]);
    this.backOutline.set([...backs, ...turning]);
    this.front.set(fronts);
    this.back.set([...backs, ...turning]);
    this.inPlane.set(edges);
  }
}
