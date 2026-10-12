import { expect, test, type Page } from '@playwright/test';

// M5: CPL is live. The editor changes what the running world does; a saved object
// takes its code into a fresh session.
async function open(page: Page, query: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?still=1&${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  return errors;
}

type P3 = [number, number, number];
type Pose = Partial<{ x: number; y: number; z: number; yaw: number; pitch: number }>;
const set = (page: Page, p: Pose) => page.evaluate((pp) => window.__cutplane!.set(pp), p);
const locate = <T>(page: Page, what: string) =>
  page.evaluate((w) => window.__cutplane!.locate(w), what) as Promise<T>;
const click = async (page: Page, at: P3 | number[], z: number) => {
  await set(page, { x: at[0], y: at[1], z });
  await page.evaluate(() => window.__cutplane!.press());
  await page.evaluate(() => window.__cutplane!.release());
};
/** Stamps the first primitive; returns the stamped copy's height (the centre of what is picked). */
async function stamp(page: Page): Promise<number> {
  const Z = -480;
  // Stamping closes the box (stamp.cpl), so it is closed each time we come to it.
  await click(page, await locate<P3>(page, 'prims'), Z);
  const [prim] = await locate<P3[]>(page, 'stamps');
  await click(page, prim!, Z);
  return (await locate<P3>(page, 'picked'))[1];
}

test('editing stamp.cpl in the running app changes stamping at once', async ({ page }) => {
  const errors = await open(page, 'sample=cube');
  const before = await stamp(page);
  await page.getByRole('button', { name: 'Code' }).click();
  const panel = page.getByLabel('CPL editor');
  await panel.getByLabel('Code to show').selectOption('stamp.cpl');
  const code = panel.getByLabel('CPL code');
  const text = await code.inputValue();
  expect(text).toContain('Stamp_sub');
  await code.fill(
    text.replace(
      /(\tDUP\tA:R1\*,A:R2\s*\n)/,
      '$1\t\tTRANS\tA:R2*,Const:Normaltranslate,Const:V[0.0,200.0,0.0]\n',
    ),
  );
  await panel.getByRole('button', { name: 'Apply' }).click();
  await expect(panel.locator('.errors')).toHaveText(/Applied/);
  const after = await stamp(page);
  expect(after - before).toBeCloseTo(200, 0);
  expect(errors).toEqual([]);
});

test('a saved object carries its private code into a fresh session', async ({ page }) => {
  const errors = await open(page, 'sample=cube');
  // Pick the cube and give it code (through the editor): picked, it hops up 50.
  await click(page, [0, 0, 0], 0);
  await page.getByRole('button', { name: 'Code' }).click();
  const panel = page.getByLabel('CPL editor');
  await panel.getByLabel('Code to show').selectOption('picked');
  await expect(panel.locator('.info')).toContainText('cube');
  await panel
    .getByLabel('CPL code')
    .fill(
      [
        'Hopper\tBWIPED\tAA:XOP*,A:_Hop_end&',
        '\t\tBNEQUAL\tAA:XOP*,Opcd:PICK,A:_Hop_end&',
        '\t\tOWNER\tA:R1,Const:Self',
        '\t\tTRANS\tA:R1*,Const:Normaltranslate,Const:V[0.0,50.0,0.0]',
        '\t\tWIPE\tA:XOP*',
        '_Hop_end\tRTS',
        '',
      ].join('\n'),
    );
  await panel.getByRole('button', { name: 'Apply' }).click();
  await expect(panel.locator('.errors')).toHaveText(/Applied/);
  const saved = await page.evaluate(() => window.__cutplane!.saveText());
  expect(saved).toContain('Object CPL private code');

  // A fresh session: reload, open the saved file, pick the cube.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await page.evaluate((t) => window.__cutplane!.openText(t), saved);
  const height = () =>
    page.evaluate(() => {
      const t = window.__cutplane!.saveText();
      return Number([...t.matchAll(/Object Transform:\n(?:.*\n){3}\s*\[\s*(\S+)\s+(\S+)/g)][0]![2]);
    });
  const y0 = await height();
  await click(page, [0, 0, 0], 0);
  expect((await height()) - y0).toBeCloseTo(50, 0);
  expect(errors).toEqual([]);
});
