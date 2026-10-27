import type { WebSocket } from 'ws';

/** What the server asks the app to do (see packages/app/src/mcp.ts, which does it). */
export interface Request {
  id: number;
  op: string;
  args: Record<string, unknown>;
}

/** The app's answer: what it did, or why it couldn't. */
export type Reply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string }; // prettier-ignore

/** How long the app has to answer (an animated move takes as long as it is asked to). */
export const REPLY_MS = 30_000;

/**
 * The link to the app open in a browser with ?mcp: one page at a time (the last to
 * connect; a reload takes over from itself). Each request waits for the app's reply.
 */
export class Bridge {
  private socket: WebSocket | null = null;
  private next = 1;
  private readonly waiting = new Map<number, { done: (r: Reply) => void; timer: NodeJS.Timeout }>(); // prettier-ignore

  get connected(): boolean {
    return this.socket !== null;
  }

  attach(socket: WebSocket): void {
    this.socket?.close(1000, 'another page took over');
    this.socket = socket;
    socket.on('message', (data) => {
      let reply: Reply;
      try {
        reply = JSON.parse(String(data)) as Reply;
      } catch {
        return;
      }
      const w = this.waiting.get(reply.id);
      if (!w) return;
      clearTimeout(w.timer);
      this.waiting.delete(reply.id);
      w.done(reply);
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      for (const [id, w] of this.waiting) {
        clearTimeout(w.timer);
        w.done({ id, ok: false, error: 'the page closed' });
      }
      this.waiting.clear();
    });
  }

  /** Asks the app to do `op`; its result, or an Error saying why not. */
  async call(op: string, args: Record<string, unknown> = {}, ms = REPLY_MS): Promise<unknown> {
    const socket = this.socket;
    if (!socket)
      throw new Error(
        'No Cutplane page is connected. Open the app with ?mcp (http://localhost:5173/?mcp).',
      );
    const id = this.next++;
    const reply = await new Promise<Reply>((done) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        done({ id, ok: false, error: `the page didn't answer ${op} in ${ms / 1000} s` });
      }, ms);
      this.waiting.set(id, { done, timer });
      socket.send(JSON.stringify({ id, op, args } satisfies Request));
    });
    if (!reply.ok) throw new Error(reply.error);
    return reply.result;
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
