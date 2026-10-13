import { describe, expect, it } from 'vitest';
import { readCut, writeCut } from '@cutplane/formats';
import { historyOrder, loadHistory, saveHistory } from '../src/index.ts';
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
});
