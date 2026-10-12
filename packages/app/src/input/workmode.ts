/**
 * Work mode: full screen with a captured pointer, so the crosshair, plane
 * and room can be pushed indefinitely without the cursor reaching a screen
 * edge — the SGI's model, where the window system never got in the way.
 *
 * - off: windowed; the crosshair follows the (hidden) OS cursor.
 * - on: full screen + pointer lock; input is raw relative motion.
 * - paused: the lock was lost (Esc, ⌘-Tab, a notification). Everything
 *   stays where it was; a click resumes.
 *
 * Where the browser supports the Keyboard Lock API (Chromium, full screen),
 * a tap of Esc reaches the app and only a held Esc leaves work mode.
 */
export type WorkState = 'off' | 'on' | 'paused';

/** Pointer-lock deltas bigger than this right after locking are spurious (some Chromium builds). */
const SPIKE = 250;
const SETTLE_MS = 150;

interface KeyboardLock {
  lock(codes?: string[]): Promise<void>;
  unlock(): void;
}

export class WorkMode {
  state: WorkState = 'off';
  /** Why work mode is unavailable, if it is. */
  unsupported: string | undefined;
  private lockedAt = 0;
  private wanted = false;
  /** Cleared once the browser says unadjustedMovement isn't supported. */
  private raw = true;
  private locking = false;
  private readonly listeners = new Set<(s: WorkState) => void>();

  constructor(
    private readonly root: HTMLElement,
    private readonly target: HTMLElement,
  ) {
    if (!('requestPointerLock' in target))
      this.unsupported = 'pointer lock is not available in this browser';
    document.addEventListener('pointerlockchange', () => this.sync());
    document.addEventListener('pointerlockerror', () => this.sync());
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && this.wanted) this.exit();
    });
  }

  onChange(f: (s: WorkState) => void): void {
    this.listeners.add(f);
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  async enter(): Promise<void> {
    if (this.unsupported) return;
    this.wanted = true;
    // Ask for both from the same click: some browsers spend the click's user activation on
    // full screen, and pointer lock needs one too. Full screen may be refused (iframes,
    // permissions); pointer lock alone still keeps the cursor in.
    const locking = this.lock();
    if (!document.fullscreenElement)
      await this.root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    const kb = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
    if (document.fullscreenElement && kb) kb.lock(['Escape']).catch(() => {});
    await locking;
  }

  /** Re-acquires the pointer after a pause (needs a user gesture). */
  async resume(): Promise<void> {
    if (this.wanted) await this.lock();
  }

  exit(): void {
    this.wanted = false;
    (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard?.unlock();
    if (this.locked) document.exitPointerLock();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    this.sync();
  }

  /** Filters a relative motion sample; returns false to drop it. */
  accept(dx: number, dy: number): boolean {
    return !(performance.now() - this.lockedAt < SETTLE_MS && Math.hypot(dx, dy) > SPIKE);
  }

  private async lock(): Promise<void> {
    const t = this.target as HTMLElement & {
      requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void;
    };
    this.locking = true;
    try {
      // Raw, unaccelerated deltas where supported, like the SGI's valuators.
      await t.requestPointerLock(this.raw ? { unadjustedMovement: true } : undefined);
    } catch (e) {
      if (this.raw && e instanceof DOMException && e.name === 'NotSupportedError') {
        this.raw = false;
        await Promise.resolve(t.requestPointerLock()).catch(() => {});
      }
      // Otherwise denied: stay paused until the next click.
    }
    this.locking = false;
    this.sync();
  }

  private sync(): void {
    const next: WorkState = !this.wanted ? 'off' : this.locked ? 'on' : 'paused';
    if (next === 'paused' && this.locking) return; // don't flash the pause overlay mid-request
    if (next === 'on' && this.state !== 'on') this.lockedAt = performance.now();
    if (next === this.state) return;
    this.state = next;
    for (const f of this.listeners) f(next);
  }
}
