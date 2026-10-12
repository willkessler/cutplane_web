import { PROPERTY_FILES, type CplAssemblyError, type Feature } from '@cutplane/cpl';
import { isObject, isSub, type Runtime } from '@cutplane/behaviors';

/**
 * The CPL editor and inspector (new; outside work mode only, so nothing flat
 * sits over the room while working). It shows the code a property file runs
 * (stamp.cpl, toolbox.cpl...) or the private code of what is picked, with
 * the picked thing's name and properties, and applies an edit live: the
 * world runs the new code from the next frame. A broken edit is refused and
 * its errors listed; the old code keeps running.
 */
export class CodePanel {
  private readonly root: HTMLElement;
  private readonly which: HTMLSelectElement;
  private readonly text: HTMLTextAreaElement;
  private readonly info: HTMLElement;
  private readonly errors: HTMLElement;
  /** The feature whose private code is shown, when that is what's shown. */
  private target: Feature | null = null;
  private shownKey = '';

  constructor(
    private readonly rt: () => Runtime,
    host: HTMLElement,
  ) {
    this.root = host;
    this.which = host.querySelector('select')!;
    this.text = host.querySelector('textarea')!;
    this.info = host.querySelector('.info')!;
    this.errors = host.querySelector('.errors')!;
    this.which.add(new Option('Private code of what is picked', 'picked'));
    for (const p of PROPERTY_FILES) {
      const f = `${p.toLowerCase()}.cpl`;
      this.which.add(new Option(`${f} (the ${p} property)`, f));
    }
    this.which.value = 'stamp.cpl';
    this.which.addEventListener('change', () => this.show(true));
    host.querySelector<HTMLButtonElement>('.apply')!.addEventListener('click', () => this.apply());
    host
      .querySelector<HTMLButtonElement>('.close')!
      .addEventListener('click', () => this.toggle(false));
    this.text.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing is not a command
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.apply();
      } else if (e.key === 'Tab') {
        // CPL is laid out in tab columns.
        e.preventDefault();
        this.text.setRangeText('\t', this.text.selectionStart, this.text.selectionEnd, 'end');
      }
    });
  }

  get open(): boolean {
    return this.root.classList.contains('shown');
  }

  toggle(on = !this.open): void {
    this.root.classList.toggle('shown', on);
    if (on) this.show(true);
  }

  /** Follows the picks (for the inspector); `force` reloads the text even if unchanged. */
  show(force = false): void {
    if (!this.open) return;
    const rt = this.rt();
    if (this.which.value !== 'picked') {
      this.target = null;
      const key = `file:${this.which.value}`;
      if (force || key !== this.shownKey) {
        this.text.value = rt.propertySource(this.which.value) ?? '';
        this.info.textContent = `${this.which.value} runs for everything with the property; an edit applies to all of them at once.`;
        this.errors.textContent = '';
      }
      this.shownKey = key;
      return;
    }
    const f = rt.picked(rt.primary)[0] ?? rt.picked(rt.environment)[0] ?? null;
    const key = `picked:${f ? describe(rt, f) : ''}`;
    if (!force && key === this.shownKey && f === this.target) return;
    this.shownKey = key;
    this.target = f;
    this.errors.textContent = '';
    if (!f) {
      this.info.textContent =
        'Nothing is picked. Pick an object (or a vertex, edge or face) to see its code.';
      this.text.value = '';
      return;
    }
    const props = rt.vm.propNames(f).join(', ') || 'none';
    this.info.textContent = `${describe(rt, f)} — properties: ${props}`;
    this.text.value = rt.vm.privateSources.get(f) ?? '';
  }

  private apply(): void {
    const rt = this.rt();
    let err: CplAssemblyError | null;
    if (this.which.value === 'picked') {
      if (!this.target) return;
      err = rt.setPrivateCode(this.target, this.text.value, `${describe(rt, this.target)}.cpl`);
    } else err = rt.setPropertyCode(this.which.value, this.text.value);
    this.errors.textContent = err
      ? err.errors.map((e) => `line ${e.line}: ${e.message}`).join('\n')
      : 'Applied: the world runs the new code now.';
    this.errors.classList.toggle('bad', err !== null);
  }
}

function describe(rt: Runtime, f: Feature): string {
  if (isObject(f)) return f.name ?? 'an unnamed object';
  if (isSub(f)) {
    const kind =
      ['', '', '', '', '', '', '', '', 'vertex', 'edge', '', '', 'face', 'shell'][f.type] ??
      'feature';
    return `${f.object.name ?? 'object'} ${kind} ${f.id}`;
  }
  return rt.name(f) ?? 'feature';
}
