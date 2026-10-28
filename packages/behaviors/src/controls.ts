import {
  Env,
  Op,
  P,
  boolWord,
  envWord,
  offsetWord,
  opcodeWord,
  propWord,
  Aux,
  setupAux,
  Word,
  charWord,
  messageWord,
} from '@cutplane/cpl';
import type { Feature } from '@cutplane/cpl';
import type { CutObject } from '@cutplane/kernel';
import { isObject, isSub } from './features.ts';
import type { Runtime, V3 } from './runtime.ts';
import { alignPicked, distributePicked } from './align.ts';
import { unionPicked } from './modeling.ts';
import { charstreamOf } from './tools/plates.ts';

/**
 * Input as CPL (controls.c): button presses, key commands and crosshair
 * motion become instruction sentences in RAM, which the next frame's ROM
 * pass examines and the features' code acts on.
 */

/** update.c's drag_valid: a press becomes a drag past Pkboxsize / 2 in x or y... */
export const DRAG_DEAD_ZONE = 5;
/** ...or once the plane has moved more than Onplanetol. */
export const ON_PLANE_TOL = 1e-3;
/** controls.c's DUPLICATEBUTTON offset. */
export const DUPLICATE_OFFSET: V3 = [100, 100, 0];

/** How long the plane jump's glide takes. */
export const GLIDE_MS = 250;

export class Controls {
  /** Pick button held. */
  pickHeld = false;
  /**
   * The press held was on something of the room (a tool's bar or dial, a pad), not of
   * the world being made (new: what the drag guides go by).
   */
  pressedRoom = false;
  /** Plane-move button (quasimode) held. */
  planeHeld = false;
  constrainHeld = false;
  /** Shift (Multipleselect) held at the last press. */
  private multiple = false;
  private dragOrigin: V3 | null = null;
  private alreadyValidDrag = false;
  private waitForGoodDrag = false;
  /** Something happened this frame. */
  private events = false;
  private gliding: { start: number | undefined; done: number } | null = null;
  /** What was picked when R was pressed, to pick again once its snap is done (new). */
  private repick: Feature[] | null = null;

  constructor(private readonly rt: Runtime) {}

  private get vm() {
    return this.rt.vm;
  }

  // ---- buttons (encode_statechange) ----

  /** A tool key pressed mid-press, for once the release has been seen (takeTool). */
  private afterRelease: (() => void) | null = null;

  pressPick(shift: boolean): void {
    if (this.pickHeld) return;
    this.pickHeld = true;
    this.rt.pickHeld = true;
    this.multiple = shift;
    this.events = true;
    // Selectables are found now, so the press acts on what is under the crosshair.
    this.rt.setSelectables();
    this.pressedRoom = this.vm.props.features(this.rt.environment, P.Selectable).length > 0;
    this.vm.storeInstruction(opcodeWord(shift ? Op.MPICK : Op.PICK), propWord(P.Selectable, true));
    this.setDragOrigin();
  }

  releasePick(): void {
    if (!this.pickHeld) return;
    this.pickHeld = false;
    this.rt.pickHeld = false;
    this.events = true;
    this.rt.setSelectables();
    this.vm.storeInstruction(
      opcodeWord(this.multiple ? Op.MRELEAS : Op.RELEAS),
      propWord(P.Selectable, true),
    );
    this.dragOrigin = null;
    this.alreadyValidDrag = false;
  }

  pressPlane(): void {
    if (this.planeHeld) return;
    this.planeHeld = true;
    this.events = true;
    this.vm.storeInstruction(opcodeWord(Op.PICK), envWord(Env.Cutplane_part));
    this.gliding = null; // the plane is the user's again
    this.vm.encodeInstruction(' MAKEMSG Msg:Canceljump');
    this.vm.encodeInstruction(' QMSG Obj:Crosshair_Cursor,Const:Noprioritymsg');
    this.vm.encodeInstruction(' PUSH Const:TRUE');
    this.vm.encodeInstruction(' CRTN Crtn:set_hiddenedge');
  }

  releasePlane(): void {
    if (!this.planeHeld) return;
    this.planeHeld = false;
    this.events = true;
    this.vm.storeInstruction(opcodeWord(Op.RELEAS), envWord(Env.Cutplane_part));
    this.vm.encodeInstruction(' PUSH Const:FALSE');
    this.vm.encodeInstruction(' CRTN Crtn:set_hiddenedge');
    this.vm.encodeInstruction(' GLUPDATE Const:URedrawflag/when:Now');
  }

  /** Ctrl (Constrain): cursor.cpl's Constraining message. */
  setConstrain(on: boolean): void {
    if (on === this.constrainHeld) return;
    this.constrainHeld = on;
    this.events = true;
    this.vm.encodeInstruction(' WORLD Const:WEnvironment_world');
    this.vm.encodeInstruction(' MAKEMSG Msg:Constraining');
    this.vm.encodeInstruction(` MAKEMSG Const:${on ? 'TRUE' : 'FALSE'}`);
    this.vm.encodeInstruction(' QMSG Obj:Crosshair_Cursor,Const:Prioritymsg');
    this.vm.encodeInstruction(' WORLD Const:WPrimary_world');
  }

  // ---- keys (update_queued_buttons) ----

  delete(): void {
    this.events = true;
    this.vm.encodeInstruction(' MAKEMSG Msg:Delete');
    this.vm.encodeInstruction(' QMSG Prop:Picked*,Const:Noprioritymsg');
  }

  /** ⌘A (new): cursor.cpl's marquee release, with the whole world as the marquee. */
  selectAll(): void {
    this.events = true;
    this.vm.encodeInstruction(' MAKEMSG Msg:Unpick');
    this.vm.encodeInstruction(' QMSG Prop:Picked*,Const:Noprioritymsg');
    // New here: each thing whole, a picked one too (ANCEST Prop:Visible* gave its scale box).
    this.vm.encodeInstruction(' CRTN Crtn:world_things');
    this.vm.encodeInstruction(' POP A:R3');
    this.vm.encodeInstruction(' MAKEMSG Msg:Pick');
    this.vm.encodeInstruction(' QMSG A:R3*,Const:Noprioritymsg');
  }

  /** New, for an agent's call: these picked whole, and nothing else (as a marquee would). */
  pickOnly(fs: Feature[]): void {
    this.events = true;
    this.vm.encodeInstruction(' MAKEMSG Msg:Unpick');
    this.vm.encodeInstruction(' QMSG Prop:Picked*,Const:Noprioritymsg');
    if (fs.length === 0) return;
    this.rt.handOver = fs;
    this.vm.encodeInstruction(' CRTN Crtn:handed_over');
    this.vm.encodeInstruction(' POP A:R3');
    this.vm.encodeInstruction(' MAKEMSG Msg:Pick');
    this.vm.encodeInstruction(' QMSG A:R3*,Const:Noprioritymsg');
  }

  duplicate(): void {
    this.events = true;
    this.vm.encodeInstruction(' DUP Prop:Picked*,A:R3');
    // New here: not always DUPLICATE_OFFSET over (Runtime.placeCopy).
    this.vm.encodeInstruction(' PUSH A:R3*');
    this.vm.encodeInstruction(' CRTN Crtn:place_copies');
    this.vm.encodeInstruction(' MAKEMSG Msg:Unpick');
    this.vm.encodeInstruction(' QMSG Prop:Picked*,Const:Noprioritymsg');
    this.vm.encodeInstruction(' MAKEMSG Msg:Pick');
    this.vm.encodeInstruction(' QMSG A:R3*,Const:Noprioritymsg');
  }

  /**
   * Space: cursor.cpl's Jumplane works out the jump (to the back wall, or back);
   * glide() then moves the plane there over GLIDE_MS (cutplane_web's cursor.cpl).
   */
  planeJump(): void {
    this.events = true;
    this.vm.encodeInstruction(' MAKEMSG Msg:Jumplane');
    this.vm.encodeInstruction(' QMSG Obj:Crosshair_Cursor,Const:Prioritymsg');
    this.gliding = { start: undefined, done: 0 };
  }

  /** Whether a plane jump is still gliding. */
  get planeGliding(): boolean {
    return this.gliding !== null;
  }

  /** Each frame of a plane jump: Glideplane with this frame's share of it, eased in and out. */
  glide(now: number): void {
    const g = this.gliding;
    if (!g) return;
    g.start ??= now;
    const t = Math.min(1, (now - g.start) / GLIDE_MS);
    const f = t >= 1 ? 1 : (1 - Math.cos(Math.PI * t)) / 2;
    const share = f - g.done;
    if (t >= 1) this.gliding = null;
    if (share <= 0) return;
    g.done = f;
    this.events = true;
    this.vm.encodeInstruction(' MAKEMSG Msg:Glideplane');
    this.vm.encodeInstruction(
      ` MAKEMSG Const:M[{0.0,0.0,0.0,0.0},{0.0,0.0,0.0,0.0},{0.0,0.0,${share},0.0},{0.0,0.0,0.0,1.0}]`,
    );
    this.vm.encodeInstruction(' QMSG Obj:Crosshair_Cursor,Const:Noprioritymsg');
  }

  /** The R key: rotatecircle.cpl's Snaprotatetool message. */
  snapRotateTool(): void {
    this.events = true;
    // New here: the tool comes to a face of a group picked whole, and what was picked
    // stays picked (the snap picks only what it came to): the turn takes it all.
    this.rt.offerParts = true;
    this.repick = this.rt.picked().slice();
    this.vm.encodeInstruction(' MAKEMSG Msg:Snaprotatetool');
    this.vm.encodeInstruction(' QMSG Obj:Rotatetool_Innercircle,Const:Prioritymsg');
  }

  /** G (GROUPBUTTON): group.cpl groups what is picked, or ungroups a picked group. */
  group(): void {
    this.events = true;
    this.vm.encodeInstruction(' MAKEMSG Msg:Activate');
    this.vm.encodeInstruction(' QMSG Obj:Grouptool,Const:Prioritymsg');
  }

  /** \\ (SLICEBUTTON): what is picked, groups whole, is sliced at the plane, the pieces pulled apart. */
  slice(): void {
    this.events = true;
    this.vm.encodeInstruction(' PUSH Prop:Picked*');
    this.vm.encodeInstruction(' CRTN Crtn:saw_targets');
    this.vm.encodeInstruction(' CRTN Crtn:slice_object');
    this.vm.encodeInstruction(' POP A:R2');
    this.vm.encodeInstruction(' TRANS A:R2*,Const:Normaltranslate,Const:V[0.0,0.0,-10.0]');
    this.vm.encodeInstruction(' POP A:R3');
    this.vm.encodeInstruction(' TRANS A:R3*,Const:Normaltranslate,Const:V[0.0,0.0,10.0]');
  }

  /** B: what is picked is unioned into one object (modeling.ts). */
  union(): void {
    this.events = true;
    unionPicked(this.rt);
  }

  /** New here: A lines up what is picked (align.ts). */
  align(): void {
    this.events = true;
    alignPicked(this.rt);
  }

  /** New here: Shift-A spaces out what is picked evenly (align.ts). */
  distribute(): void {
    this.events = true;
    distributePicked(this.rt);
  }

  /**
   * After R's snap (new): what was picked before is picked again, but for whatever
   * holds what the snap picked (that turns with it anyway, its group whole).
   */
  private pickAgain(before: Feature[]): void {
    this.repick = null;
    const thing = (f: Feature): CutObject | null => {
      let o = isObject(f) ? f : isSub(f) ? f.object : null;
      while (o?.parent && !(o.linked ?? false) && !this.rt.hasProp(o.parent, 'Scalebbox'))
        o = o.parent;
      return o;
    };
    const now = this.rt.picked();
    const held = new Set(now.map(thing));
    const again = before.filter((f) => !now.includes(f) && !held.has(thing(f)));
    if (again.length === 0) return;
    this.events = true;
    this.rt.handOver = again;
    this.vm.encodeInstruction(' CRTN Crtn:handed_over');
    this.vm.encodeInstruction(' POP A:R3');
    this.vm.encodeInstruction(' MAKEMSG Msg:Pick');
    this.vm.encodeInstruction(' QMSG A:R3*,Const:Noprioritymsg');
  }

  private messagesWaiting(): boolean {
    return this.rt.worlds.some((w) => this.vm.props.features(w, P.Msgpending).length > 0);
  }

  /** Z, H and P (ZTOOLBUTTON, PANTOOLBUTTON; P new here): the magnifier, pan tool or pencil comes to the crosshair. */
  takeTool(name: 'Magnifier' | 'Pantool' | 'Pencil' | 'Ruler' | 'Globe'): void {
    // New here: pressed mid-press (a marquee, a drag), it comes once the button is let go.
    // Taken then, the tool is active when the marquee ends, and is sent the marqueed set,
    // which a tool that reads no messages (pan.cpl) never takes off its queue: stuck at its
    // head, it kept the tool from ever seeing a press again. (The original's pads, the only
    // way to a tool, took a click, so a tool never came mid-press.)
    if (this.pickHeld) {
      this.afterRelease = () => this.takeTool(name);
      return;
    }
    this.events = true;
    this.vm.encodeInstruction(' MAKEMSG Msg:Activatetool');
    this.vm.encodeInstruction(` QMSG Obj:${name},Const:Prioritymsg`);
  }

  /** New: a tool in hand goes back to a free pad, as one does once used (tool.cpl's Attachtool). */
  putToolAway(name: 'Globe' | 'Magnifier'): void {
    this.events = true;
    this.vm.encodeInstruction(' WORLD Const:WEnvironment_world');
    this.vm.encodeInstruction(' MAKEMSG Msg:Attachtool');
    this.vm.encodeInstruction(` MAKEMSG Obj:${name}`);
    this.vm.encodeInstruction(' QMSG Prop:Toolpadempty*,Const:Prioritymsg');
    this.vm.encodeInstruction(' WORLD Const:WPrimary_world');
  }

  /**
   * New: Esc puts whatever tool the crosshair holds back on its pad. Activatetool to a
   * tool already in hand does it (tool.cpl). False: nothing was in hand.
   */
  putToolInHandAway(): boolean {
    const vm = this.vm;
    const held = this.rt.cursorObj.children.filter(
      (o) => vm.props.has(o, P.Tool) && vm.props.has(o, P.Active),
    );
    if (held.length === 0) return false;
    let msg = vm.messages.indexOf('Activatetool');
    if (msg < 0) msg = vm.messages.push('Activatetool') - 1;
    for (const t of held) {
      vm.enterMessage(messageWord(msg));
      vm.queueMessage(t, true);
      vm.messageBlockReset();
    }
    this.events = true;
    return true;
  }

  /**
   * New: a goodie (the camera, the colour control) goes back into its box and the box
   * closes, as when it's dropped on the box (goodies.cpl's _Try_dunk).
   */
  putGoodieAway(name: string, box = 'Goodiesbox'): void {
    this.events = true;
    this.vm.encodeInstruction(' WORLD Const:WEnvironment_world');
    this.vm.encodeInstruction(' MAKEMSG Msg:Dunkobject');
    this.vm.encodeInstruction(` MAKEMSG Obj:${name}`);
    this.vm.encodeInstruction(' MAKEMSG Msg:Closetoolbox');
    this.vm.encodeInstruction(` QMSG Obj:${box},Const:Prioritymsg`);
    this.vm.encodeInstruction(' WORLD Const:WPrimary_world');
  }

  /** store_roomrot: the room turns by (dx, dy) tenths of a degree. */
  rotateRoom(dx: number, dy: number): void {
    const ad = new Word();
    setupAux(ad, Aux.Rotate);
    ad.vec = [dx, dy, 0, 0, 0, 0, 0];
    this.vm.storeInstruction(opcodeWord(Op.ROTATE), envWord(Env.Room_part), ad);
  }

  // ---- typing (stream_char_to_objects) ----

  /** Something (a text input) wants typed characters instead of key commands. */
  get typing(): boolean {
    return charstreamOf(this.rt).length > 0;
  }

  /**
   * A typed character goes to each listener as an Incomingchar message: printable
   * characters, and ^H (backspace), ^B / ^F (left / right), CR and ESC.
   */
  typeChar(code: number): void {
    const vm = this.vm;
    let msg = vm.messages.indexOf('Incomingchar');
    if (msg < 0) msg = vm.messages.push('Incomingchar') - 1;
    for (const f of charstreamOf(this.rt)) {
      vm.enterMessage(messageWord(msg));
      vm.enterMessage(charWord(code));
      vm.queueMessage(f, true);
      vm.messageBlockReset();
    }
    this.events = true;
  }

  // ---- motion (store_mouse_cursor_move, store_cursor_move) ----

  private setDragOrigin(): void {
    if (this.dragOrigin) return;
    this.dragOrigin = this.rt.cursor();
    this.alreadyValidDrag = false;
    this.waitForGoodDrag = true;
  }

  private dragValid(to: V3): boolean {
    const o = this.dragOrigin;
    if (!o) return false;
    if (!this.alreadyValidDrag)
      this.alreadyValidDrag =
        Math.abs(to[2] - o[2]) > ON_PLANE_TOL ||
        Math.abs(to[0] - o[0]) > DRAG_DEAD_ZONE ||
        Math.abs(to[1] - o[1]) > DRAG_DEAD_ZONE;
    return this.alreadyValidDrag;
  }

  /**
   * The crosshair (and, with the plane button, the plane) should move by `d`. `actual`
   * says how far it really will (the room's limits, plane snapping): what is dragged
   * moves by exactly that, so it stays with the crosshair.
   */
  moveCrosshair(d: V3, actual: (d: V3) => V3): void {
    if (d[0] === 0 && d[1] === 0 && d[2] === 0) return;
    const c = this.rt.cursor();
    const real = actual(d);
    const projected: V3 = [c[0] + real[0], c[1] + real[1], c[2] + real[2]];
    if (this.pickHeld && this.dragValid(projected)) {
      // The first drag step catches up with the crosshair from where the press was.
      let drag = real;
      if (this.waitForGoodDrag) {
        this.waitForGoodDrag = false;
        const o = this.dragOrigin!;
        drag = [real[0] + c[0] - o[0], real[1] + c[1] - o[1], real[2] + c[2] - o[2]];
      }
      this.vm.storeInstruction(
        opcodeWord(Op.TRANS),
        propWord(P.Picked, true),
        boolWord(true),
        offsetWord(drag),
      );
    }
    this.vm.storeInstruction(
      opcodeWord(Op.TRANS),
      envWord(Env.Crosshair_part),
      boolWord(false),
      offsetWord(d),
    );
  }

  /** Is a press waiting to become a drag (inside the dead zone)? */
  get pressedStill(): boolean {
    return this.pickHeld && !this.alreadyValidDrag;
  }

  // ---- the frame (new_update_state) ----

  /**
   * One frame: CPL if anything is waiting, then updates, then selectables. A gesture
   * ends (as one undoable step) once no button is held.
   */
  frame(): boolean {
    // new_user_input: input events find selectables first (set_selectables_definite)...
    if (this.events) this.rt.setSelectables();
    this.events = false;
    const ran = this.vm.step();
    this.rt.endFrame();
    if (!this.pickHeld && this.afterRelease) {
      const then = this.afterRelease;
      this.afterRelease = null;
      then();
    }
    if (this.repick && !this.messagesWaiting()) {
      this.rt.offerParts = false;
      this.pickAgain(this.repick);
    }
    if (!this.pickHeld && !this.planeHeld) {
      this.rt.finishDrags();
      this.rt.commit();
    }
    // ...and every frame finds them again before drawing, from where things are now.
    this.rt.setSelectables();
    return ran;
  }
}
