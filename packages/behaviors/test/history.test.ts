import { describe, expect, it } from 'vitest';
import { readCut, writeCut } from '@cutplane/formats';
import { historyOrder, loadHistory, saveHistory } from '../src/index.ts';
import { HISTORY_BUDGET } from '../src/history.ts';
import { world } from './world.ts';

const text = (w: ReturnType<typeof world>) =>
  writeCut({ title: 'w', contains: 'World', name: null, roots: w.rt.documentRoots() });

describe('the undo history kept with an autosave', () => {
  it('comes back in a fresh session: every undo and redo gives the same worlds', () => {
    const a = world();
    const { rt, controls, frame, at, move } = a;
    // A face pulled out, the cube duplicated, the copy deleted, the cube moved.
    at(100, 0, 0);
    controls.pressPick(false);
    frame();
    move(3, 0);
    move(40, 0);
    controls.releasePick();
    frame();
    at(0, 0, 0);
    controls.pressPick(false);
    frame();
    controls.releasePick();
    frame();
    controls.duplicate();
    frame();
    controls.delete();
    frame();
    frame();
    at(0, 0, 0);
    controls.pressPick(false);
    frame();
    move(3, 0);
    move(-60, 0);
    controls.releasePick();
    frame();
    rt.undo(); // one step to redo
    const undos = rt.journal.stacks().undo.length;
    expect(undos).toBeGreaterThanOrEqual(3);
    expect(rt.journal.stacks().redo.length).toBe(1);

    // Kept as text and data, as autosave keeps it.
    const kept = text(a);
    const saved = JSON.parse(JSON.stringify(saveHistory(rt.journal, rt.primary.root, historyOrder(rt.documentRoots())))); // prettier-ignore
    expect(saved.ghosts.length).toBeGreaterThan(0); // the deleted copy

    // A fresh session: the world read back, its history given back.
    const b = world();
    b.rt.clearWorld(b.rt.primary);
    const roots = readCut(kept).doc.roots;
    b.rt.importObjects(b.rt.primary, roots);
    expect(loadHistory(b.rt.journal, saved, b.rt.primary.root, historyOrder(roots))).toBe(true);
    expect(text(b)).toBe(text(a));

    const worlds = (w: ReturnType<typeof world>) => {
      const seen: string[] = [];
      while (w.rt.undo()) seen.push(text(w));
      while (w.rt.redo()) seen.push(text(w));
      return seen;
    };
    const was = worlds(a);
    expect(was.length).toBe(undos * 2 + 1);
    expect(worlds(b)).toEqual(was);
  });

  it('a history that does not fit the world is dropped, not half applied', () => {
    const { rt } = world();
    const saved = saveHistory(rt.journal, rt.primary.root, []);
    saved.undo.push({ before: [{ id: 99, cut: 'nonsense' }], after: [] });
    expect(loadHistory(rt.journal, saved, rt.primary.root, [])).toBe(false);
    expect(rt.journal.canUndo).toBe(false);
  });

  it('keeps only the newest steps that fit its budget (a big deleted model is let go)', () => {
    const a = world();
    const { rt, controls, frame, at } = a;
    at(0, 0, 0);
    controls.pressPick(false);
    frame();
    controls.releasePick();
    frame();
    controls.duplicate(); // older: brings the copy
    frame();
    controls.delete(); // newer: the copy goes (a ghost)
    frame();
    frame();
    const all = saveHistory(rt.journal, rt.primary.root, historyOrder(rt.documentRoots()));
    expect(all.undo.length).toBe(rt.journal.stacks().undo.length);
    const size = (h: typeof all) => JSON.stringify(h).length;
    // Room for the newest step alone.
    const last = all.undo.at(-1)!;
    const one = [...last.before, ...last.after].reduce((n, x) => n + x.cut.length, 0);
    const some = saveHistory(rt.journal, rt.primary.root, historyOrder(rt.documentRoots()), 200, one + all.ghosts[0]!.cut.length); // prettier-ignore
    expect(some.undo).toEqual([last]);
    expect(size(some)).toBeLessThan(size(all));
    // Nothing fits: nothing kept, and no ghost either.
    const none = saveHistory(rt.journal, rt.primary.root, historyOrder(rt.documentRoots()), 200, 0); // prettier-ignore
    expect(none).toEqual({ version: 1, ghosts: [], undo: [], redo: [] });
  });

  it('one far bigger than it would be kept is let go, not read back', () => {
    const { rt } = world();
    const saved = saveHistory(rt.journal, rt.primary.root, []);
    saved.ghosts.push({ id: 1, cut: 'x'.repeat(HISTORY_BUDGET * 2 + 1) });
    expect(loadHistory(rt.journal, saved, rt.primary.root, [])).toBe(false);
  });
});
