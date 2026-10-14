import * as THREE from 'three';
import { Flyover, SECONDS_PER_SHOT, type Shot } from '../camera/flyover.ts';

/** grafx.c's draw_on_slide clears to light blue. */
const LIGHT_BLUE = 0x87cefa;

export interface CameraWindowOptions {
  scene: THREE.Scene;
  /** What the camera mustn't see: the plane, the crosshair, the tools riding on the plane. */
  hidden: readonly THREE.Object3D[];
  /** The camera's lens now, or null if the camera isn't out in the room. */
  live: () => Shot | null;
  /** The window was closed (by its close box, or the main page going away). */
  onClose: () => void;
  /** The shots changed (to remember them). */
  onShots: (shots: Shot[], perShot: number) => void;
}

/**
 * The camera's window: grafx.c's slide window, "Camera's View", which the
 * original opened beside the main one when the camera was clicked. It shows
 * what the camera's lens sees, live as the camera is carried and aimed.
 *
 * New here (not in the 1991 code): a fly-over. "Add shot" keeps where the
 * camera is and where it looks; Play flies smoothly through the shots, and
 * Record video plays it into a video file. Being its own window, its buttons
 * cover nothing in the room.
 */
export class CameraWindow {
  private win: Window | null = null;
  private renderer: THREE.WebGLRenderer | undefined;
  private canvas: HTMLCanvasElement | undefined;
  private readonly lens = new THREE.PerspectiveCamera(50, 4 / 3, 1, 4000);
  private readonly background = new THREE.Color(LIGHT_BLUE);
  private shotList: Shot[] = [];
  private perShot = SECONDS_PER_SHOT;
  private flyover = new Flyover([]);
  private play: { start: number; recorder: MediaRecorder | undefined } | undefined;
  private ui: Record<string, HTMLElement> | undefined;
  /** Where the lens is during a fly-over, for the room to show. */
  flying: Shot | null = null;

  constructor(private readonly opts: CameraWindowOptions) {}

  get isOpen(): boolean {
    return !!this.win && !this.win.closed;
  }

  get shots(): readonly Shot[] {
    return this.shotList;
  }

  get secondsPerShot(): number {
    return this.perShot;
  }

  get playing(): boolean {
    return !!this.play;
  }

  setShots(shots: Shot[], perShot = this.perShot): void {
    this.shotList = shots.map((s) => ({ eye: [...s.eye], dir: [...s.dir] }));
    this.perShot = perShot;
    this.flyover = new Flyover(this.shotList, this.perShot);
    this.refresh();
  }

  /** Opens the window; false if the browser wouldn't (a pop-up blocker). */
  open(): boolean {
    if (this.isOpen) return true;
    const w = 720;
    const h = 600;
    const left = Math.max(0, window.screenX + window.outerWidth - w - 24);
    const top = Math.max(0, window.screenY + 80);
    const win = window.open(
      '',
      'cutplane-camera',
      `popup,width=${w},height=${h},left=${left},top=${top}`,
    );
    if (!win) return false;
    this.win = win;
    this.build(win);
    // WebKit sends pagehide as the blank page is written over, too: only a closed window counts.
    win.addEventListener('pagehide', () =>
      setTimeout(() => {
        if (win.closed && this.win === win) this.closed();
      }, 0),
    );
    win.requestAnimationFrame(this.frame);
    return true;
  }

  /** Notices a window closed by its close box (its own frames stop with it); call every frame. */
  poll(): void {
    if (this.win?.closed) this.closed();
  }

  close(): void {
    const win = this.win;
    this.teardown();
    win?.close();
  }

  /** Keeps the camera's lens as the next shot. */
  addShot(): boolean {
    const s = this.opts.live();
    if (!s) return false;
    this.setShots([...this.shotList, s]);
    this.changed();
    return true;
  }

  removeShot(): void {
    this.setShots(this.shotList.slice(0, -1));
    this.changed();
  }

  clearShots(): void {
    this.stop();
    this.setShots([]);
    this.changed();
  }

  /** Flies through the shots; with `record`, into a video file as well. */
  start(record = false): void {
    if (!this.win || this.flyover.seconds === 0) return;
    this.stop();
    let recorder: MediaRecorder | undefined;
    if (record && this.canvas) recorder = this.recorder(this.canvas);
    this.play = { start: this.win.performance.now(), recorder };
    this.refresh();
  }

  stop(): void {
    const p = this.play;
    if (!p) return;
    this.play = undefined;
    this.flying = null;
    if (p.recorder?.state === 'recording') p.recorder.stop();
    this.refresh();
  }

  private changed(): void {
    this.opts.onShots(this.shotList, this.perShot);
  }

  private closed(): void {
    if (!this.win) return;
    this.teardown();
    this.opts.onClose();
  }

  private teardown(): void {
    this.stop();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.canvas = undefined;
    this.ui = undefined;
    this.win = null;
  }

  private build(win: Window): void {
    const doc = win.document;
    doc.open();
    doc.write(PAGE);
    doc.close();
    const $ = (id: string) => doc.getElementById(id)!;
    this.canvas = $('view') as HTMLCanvasElement;
    this.ui = {
      add: $('add'),
      remove: $('remove'),
      clear: $('clear'),
      play: $('play'),
      record: $('record'),
      per: $('per'),
      status: $('status'),
      note: $('note'),
    };
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.setPixelRatio(win.devicePixelRatio);
    this.renderer = r;
    const per = this.ui['per'] as HTMLInputElement;
    per.value = String(this.perShot);
    $('add').addEventListener('click', () => {
      if (!this.addShot()) this.note('Take the camera out of its box first.');
    });
    $('remove').addEventListener('click', () => this.removeShot());
    $('clear').addEventListener('click', () => this.clearShots());
    $('play').addEventListener('click', () => (this.play ? this.stop() : this.start()));
    $('record').addEventListener('click', () => (this.play ? this.stop() : this.start(true)));
    per.addEventListener('change', () => {
      const v = Number(per.value);
      if (!(v > 0)) return;
      this.setShots(this.shotList, Math.min(60, v));
      this.changed();
    });
    doc.addEventListener('keydown', (e) => {
      if (e.target === per) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (this.play) this.stop();
        else this.start();
      } else if (e.key === 'Enter') this.addShot();
    });
    this.refresh();
  }

  private note(text: string): void {
    if (this.ui) setText(this.ui['note']!, text);
  }

  private refresh(): void {
    const ui = this.ui;
    if (!ui) return;
    const n = this.shotList.length;
    const s = this.flyover.seconds;
    setText(
      ui['status']!,
      n === 0
        ? 'No shots yet'
        : `${n} shot${n === 1 ? '' : 's'}${s ? ` · ${+s.toFixed(1)} s fly-over` : ''}`,
    );
    (ui['remove'] as HTMLButtonElement).disabled = n === 0;
    (ui['clear'] as HTMLButtonElement).disabled = n === 0;
    (ui['play'] as HTMLButtonElement).disabled = s === 0;
    (ui['record'] as HTMLButtonElement).disabled = s === 0 || !this.canRecord();
    setText(ui['play']!, this.play && !this.play.recorder ? '■ Stop' : '▶ Play');
    setText(ui['record']!, this.play?.recorder ? '■ Stop' : '● Record video');
    if (!this.play)
      this.note(
        n < 2 ? 'Place and aim the camera, then Add shot. Two or more make a fly-over.' : '',
      );
  }

  private canRecord(): boolean {
    return typeof MediaRecorder !== 'undefined' && !!this.canvas?.captureStream;
  }

  private recorder(canvas: HTMLCanvasElement): MediaRecorder | undefined {
    if (!this.canRecord()) return undefined;
    const type = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
    const rec = new MediaRecorder(canvas.captureStream(30), {
      ...(type ? { mimeType: type } : {}),
      videoBitsPerSecond: 8_000_000,
    });
    const chunks: Blob[] = [];
    rec.addEventListener('dataavailable', (e) => e.data.size && chunks.push(e.data));
    rec.addEventListener('stop', () => {
      const doc = this.win?.document ?? document;
      const blob = new Blob(chunks, { type: rec.mimeType });
      const a = doc.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `cutplane-flyover.${rec.mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
      doc.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      this.note(`Saved ${a.download}`);
    });
    rec.start();
    return rec;
  }

  private readonly frame = (): void => {
    const win = this.win;
    if (!win) return;
    if (win.closed) {
      this.closed();
      return;
    }
    win.requestAnimationFrame(this.frame);
    let shot: Shot | null;
    if (this.play) {
      const t = (win.performance.now() - this.play.start) / 1000;
      shot = this.flyover.at(t);
      this.flying = shot;
      if (t > this.flyover.seconds + 0.3) this.stop();
    } else shot = this.opts.live() ?? this.shotList.at(-1) ?? null;
    this.draw(shot);
  };

  private draw(shot: Shot | null): void {
    const r = this.renderer;
    const c = this.canvas;
    if (!r || !c) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (w === 0 || h === 0) return;
    if (
      c.width !== Math.floor(w * r.getPixelRatio()) ||
      c.height !== Math.floor(h * r.getPixelRatio())
    ) {
      r.setSize(w, h, false);
      this.lens.aspect = w / h;
      this.lens.updateProjectionMatrix();
    }
    const { scene, hidden } = this.opts;
    const bg = scene.background;
    const was = hidden.map((o) => o.visible);
    for (const o of hidden) o.visible = false;
    scene.background = this.background;
    if (shot) {
      const eye = new THREE.Vector3(...shot.eye);
      this.lens.position.copy(eye);
      this.lens.up.set(0, 1, 0);
      this.lens.lookAt(eye.add(new THREE.Vector3(...shot.dir)));
      this.lens.updateMatrixWorld();
      r.render(scene, this.lens);
    } else {
      r.setClearColor(this.background);
      r.clear();
    }
    scene.background = bg;
    hidden.forEach((o, i) => (o.visible = was[i]!));
  }
}

/**
 * Changes an element's text only if it differs: rewriting a button's text while it is
 * being pressed (a field's change on blur refreshes the bar) loses the click in WebKit.
 */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Camera's View</title>
<style>
  html, body { margin: 0; height: 100%; background: #1c1d22; color: #f3ece6;
    font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; }
  body { display: flex; flex-direction: column; }
  #stage { position: relative; flex: 1; min-height: 0; }
  #view { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  h1 { position: absolute; left: 18px; top: 10px; margin: 0; pointer-events: none;
    font: italic 32px 'Times New Roman', Times, serif; color: #fff; text-shadow: 1px 1px 0 #000; }
  #bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 10px;
    background: rgba(28, 29, 34, 0.95); }
  button, input { font: inherit; color: inherit; background: #34363e; border: 1px solid #4a4c55;
    border-radius: 6px; padding: 3px 8px; }
  button.primary { background: #0b6f6f; border-color: #13a0a0; }
  button:disabled { opacity: 0.45; }
  input { width: 4em; }
  #status { margin-left: auto; color: #b9aea6; }
  #note { width: 100%; color: #b9aea6; min-height: 1.4em; }
</style></head>
<body>
  <div id="stage"><canvas id="view"></canvas><h1>Camera's View</h1></div>
  <div id="bar">
    <button id="add" class="primary" title="Keep where the camera is and where it looks (Return)">Add shot</button>
    <button id="remove" title="Take the last shot away">Remove last</button>
    <button id="clear">Clear</button>
    <label>Seconds per shot <input id="per" type="number" min="0.5" max="60" step="0.5"></label>
    <button id="play" title="Fly through the shots (Space)">▶ Play</button>
    <button id="record" title="Fly through the shots into a video file">● Record video</button>
    <span id="status"></span>
    <div id="note"></div>
  </div>
</body></html>`;
