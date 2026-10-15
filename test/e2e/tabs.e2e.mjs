// Item tabs in the real app: double-click opens a tab, the Library tab shows the grid with the
// tab kept, Esc closes and Ctrl+Shift+T reopens, tabs come back after a restart, and a tab pops out
// into its own window that keeps the arrow keys and can be put back in the tabs.
import assert from 'node:assert/strict';
import { after, before, describe } from 'node:test';
import {
  freshLibrary,
  importFiles,
  launch,
  makeFixtures,
  sleep,
  until,
  withShots,
} from './lib/harness.mjs';
import { nav, tile, waitCount } from './lib/ui.mjs';

describe('tabs', () => {
  let ctx;
  let lib;
  let id;
  const it = withShots(() => ctx);
  const tabNames = () =>
    ctx.win.$$eval('[aria-label=Tabs] [data-key] .nm', (els) => els.map((e) => e.textContent));
  const onScreen = () => ctx.win.locator('.detail:not(.off) .name').innerText();
  const detailShown = async () => (await ctx.win.locator('.detail:not(.off)').count()) > 0;

  before(async () => {
    const f = makeFixtures();
    lib = freshLibrary('tabs');
    ctx = await launch({ name: 'tabs', open: lib });
    const names = ['red.png', 'blue.png', 'wide.png'];
    const added = await importFiles(ctx, names.map(f));
    id = Object.fromEntries(names.map((n, i) => [n.replace('.png', ''), added[i]]));
    await waitCount(ctx.win, 6);
  });
  after(() => ctx?.close());

  it('opens tabs, switches to the library and back, Esc closes and Ctrl+Shift+T reopens', async () => {
    const { win } = ctx;
    assert.equal(await win.locator('[aria-label=Tabs]').count(), 0, 'no tab row before a tab');
    await tile(win, id.red).locator('.th').dblclick();
    await until(async () => (await tabNames()).join() === 'red', 'a tab for red');

    await win.locator('[aria-label=Tabs] .tab.lib').click();
    await until(async () => !(await detailShown()), 'the grid on screen');
    assert.equal(await tile(win, id.red).locator('.open').count(), 1, 'the open dot on its tile');

    await tile(win, id.blue).locator('.th').dblclick();
    await until(async () => (await tabNames()).join() === 'red,blue', 'a second tab');
    assert.equal(await onScreen(), 'blue');
    await win.locator('[aria-label=Tabs] [data-key]').first().click();
    await until(async () => (await onScreen()) === 'red', 'back on the red tab');

    await win.keyboard.press('Escape');
    await until(async () => (await tabNames()).join() === 'blue', 'Esc closed the red tab');
    assert.ok(!(await detailShown()), 'Esc goes back to the library');
    await win.keyboard.press('Control+Shift+T');
    await until(async () => (await tabNames()).join() === 'blue,red', 'red reopened');
    assert.equal(await onScreen(), 'red');
  });

  it('the tabs come back after a restart, with the library on screen', async () => {
    await ctx.close();
    ctx = await launch({ name: 'tabs', open: lib, keepHome: true });
    await until(async () => (await tabNames()).join() === 'blue,red', 'the saved tabs');
    assert.ok(!(await detailShown()));
    await ctx.win.locator('[aria-label=Tabs] [data-key]').nth(1).click();
    await until(async () => (await onScreen()) === 'red', 'a restored tab opens');
  });

  it('pops a tab out into a window that steps with the arrows, and puts it back', async () => {
    const { win, app } = ctx;
    const opened = app.waitForEvent('window');
    await win.getByRole('button', { name: 'Pop out into its own window' }).click();
    const pop = await opened;
    await pop.waitForLoadState('domcontentloaded');
    await until(async () => (await tabNames()).join() === 'blue', 'the tab left the main window');
    const name = () => pop.locator('.detail .name').innerText();
    await until(async () => (await name()) === 'red', 'the pop-out shows red');
    assert.equal(await pop.locator('[aria-label=Tabs]').count(), 0, 'no tab row in a pop-out');

    await pop.keyboard.press('ArrowRight');
    await until(async () => (await name()) !== 'red', 'the arrow keys step in the pop-out');
    const stepped = await name();

    await pop.getByRole('button', { name: 'Put back in the tabs' }).click();
    await until(() => app.windows().length === 1, 'the pop-out to close');
    await until(async () => (await tabNames()).join() === `blue,${stepped}`, 'back in the tabs');
    assert.equal(await onScreen(), stepped);
    await sleep(200);
  });

  it('Ctrl+2 and up go to the item tabs in order; Ctrl+T goes to the All page', async () => {
    const { win } = ctx;
    const [first, second] = await tabNames();
    await win.keyboard.press('Control+2');
    await until(async () => (await onScreen()) === first, 'Ctrl+2: the first item tab');
    await win.keyboard.press('Control+3');
    await until(async () => (await onScreen()) === second, 'Ctrl+3: the second');
    await win.keyboard.press('Control+5'); // no fourth item tab: nothing happens
    await sleep(200);
    assert.equal(await onScreen(), second);

    await win.keyboard.press('Control+1');
    await nav(win, 'Untagged');
    await win.keyboard.press('Control+2');
    await until(detailShown, 'back on a tab');
    await win.keyboard.press('Control+t');
    await until(async () => !(await detailShown()), 'the library on screen');
    const page = () => win.locator('nav[aria-label="Library views"] [aria-current=page]').innerText();
    await until(async () => (await page()).trim().startsWith('All'), 'the All page');
  });

  // A real drag between two windows needs a desktop session; here the drag's events are sent to
  // each window by hand, with the data the pop-out put on the drag.
  it('dragging a pop-out title onto the main window puts it back in the tabs, where dropped', async () => {
    const { win, app } = ctx;
    await win.keyboard.press('Control+2');
    const item = await onScreen();
    const opened = app.waitForEvent('window');
    await win.getByRole('button', { name: 'Pop out into its own window' }).click();
    const pop = await opened;
    await pop.waitForLoadState('domcontentloaded');
    await until(async () => (await pop.locator('.detail .name').innerText()) === item, 'popped out');
    const left = await tabNames();

    const data = await pop.evaluate(() => {
      const dt = new DataTransfer();
      document.querySelector('.detail .title').dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }),
      );
      return dt.getData('application/x-boogie-tab');
    });
    assert.ok(JSON.parse(data).ids.includes(JSON.parse(data).id), 'the drag carries the item');

    await win.evaluate((data) => {
      const dt = new DataTransfer();
      dt.setData('application/x-boogie-tab', data);
      const r = document.querySelector('[aria-label=Tabs] [data-key]').getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 2, clientY: r.top + 5 };
      const target = document.elementFromPoint(at.clientX, at.clientY);
      target.dispatchEvent(new DragEvent('dragover', at));
      target.dispatchEvent(new DragEvent('drop', at));
    }, data);
    await until(async () => (await tabNames()).join() === [item, ...left].join(), 'docked first');
    assert.equal(await onScreen(), item);

    await pop.evaluate(() => {
      const dt = new DataTransfer(); // Chromium keeps a script-made dropEffect only in a real drag
      Object.defineProperty(dt, 'dropEffect', { value: 'move' });
      document.querySelector('.detail .title').dispatchEvent(
        new DragEvent('dragend', { bubbles: true, dataTransfer: dt }),
      );
    }).catch(() => {}); // the page closes itself
    await until(() => app.windows().length === 1, 'the pop-out to close');
  });
});
