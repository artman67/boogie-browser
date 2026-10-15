import { beforeEach, describe, expect, it } from 'vitest';
import { viewer as look } from '../../components/viewer/state.svelte';
import { around, tabItem, tabs } from './tabs.svelte';

const ids = ['a', 'b', 'c', 'd'];
const items = () => tabs.list.map(tabItem);
/** Read back through a call: TypeScript would assume `viewer` keeps the value just assigned. */
const shown = () => tabs.viewer;
const detail = (index: number, list = ids) => ({ mode: 'detail' as const, ids: list, index });

beforeEach(() => tabs.load(null));

describe('tabs', () => {
  it('opening, stepping and Esc in the detail view open, move and close a tab', () => {
    tabs.viewer = detail(1);
    expect(items()).toEqual(['b']);
    expect(tabs.active).toBe(tabs.list[0].key);

    tabs.viewer = detail(2); // the arrow key
    expect(items()).toEqual(['c']);

    tabs.viewer = null; // Esc
    expect(tabs.list).toEqual([]);
    expect(tabs.active).toBeNull();
    tabs.reopen();
    expect(items()).toEqual(['c']);
    expect(shown()?.index).toBe(2);
  });

  it('an item already open goes to its tab; middle-click opens behind', () => {
    tabs.viewer = detail(0);
    tabs.show(null);
    tabs.open(ids, 3, false);
    expect(items()).toEqual(['a', 'd']);
    expect(tabs.active).toBeNull();

    tabs.viewer = detail(1, ['x', 'a']); // opened again from another list
    expect(items()).toEqual(['a', 'd']);
    expect(shown()?.ids).toEqual(['x', 'a']);
  });

  it('each tab keeps its own flip, and a slideshow over a tab goes back to it', () => {
    tabs.viewer = detail(0);
    const first = tabs.active!;
    look.flip = true;
    tabs.show(null);
    tabs.viewer = detail(1);
    expect(look.flip).toBe(false);
    tabs.show(first);
    expect(look.flip).toBe(true);

    tabs.viewer = { mode: 'present', ids, index: 0 };
    tabs.viewer = null; // the slideshow ends
    expect(tabs.active).toBe(first);
    expect(shown()?.mode).toBe('detail');
    expect(tabs.list).toHaveLength(2);
  });

  it('closing the tab on screen shows the one to its right, else its left, else the library', () => {
    for (const i of [0, 1, 2]) tabs.open(ids, i, false);
    const [a, b, c] = tabs.list.map((t) => t.key);
    tabs.show(b);
    tabs.close(b);
    expect(tabs.active).toBe(c);
    tabs.close(c);
    expect(tabs.active).toBe(a);
    tabs.close(a);
    expect(tabs.active).toBeNull();
    expect(shown()).toBeNull();
  });

  it('saves a window of a long list around the item', () => {
    const long = Array.from({ length: 10 }, (_, i) => `i${i}`);
    expect(around(long, 1, 3)).toEqual({ ids: ['i0', 'i1', 'i2', 'i3', 'i4'], index: 1 });
    expect(around(long, 8, 3)).toEqual({ ids: ['i5', 'i6', 'i7', 'i8', 'i9'], index: 3 });
  });
});
