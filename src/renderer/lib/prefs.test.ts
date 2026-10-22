// Each folder keeps its own Icons or Details; the app-wide layout only follows thumbnail picks.
import { describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ api: {}, on: () => () => {}, inElectron: false }));

import { setLayout, shownLayout } from './prefs';
import { library } from './stores/library.svelte';
import { view } from './stores/view.svelte';
import type { FolderInfo } from './stores/library.svelte';

vi.spyOn(library, 'updateSettings').mockResolvedValue(undefined as never);
const node = (children: number) =>
  ({ node: { children: Array(children).fill({}) } }) as unknown as FolderInfo;
vi.spyOn(library, 'folder').mockImplementation((id) => node(id === 'refs' ? 2 : 0));
library.counts = {
  folders: { refs: { own: 0, deep: 9 }, pics: { own: 5, deep: 5 } },
} as unknown as typeof library.counts;

const open = (id: string) => (view.scope = { kind: 'folder', id, includeSubfolders: false });

describe('folder views', () => {
  it('open a folder of only folders in Details, any other in the app-wide layout', () => {
    view.layout = 'justified';
    open('refs');
    expect(shownLayout()).toBe('list');
    open('pics');
    expect(shownLayout()).toBe('justified');
  });

  it('remember a pick per folder; Details never becomes the app-wide layout', () => {
    open('refs');
    setLayout('masonry');
    expect(shownLayout()).toBe('masonry');
    open('pics');
    setLayout('list');
    expect(shownLayout()).toBe('list');
    open('refs');
    expect(shownLayout()).toBe('masonry');
    view.scope = { kind: 'all' };
    expect(shownLayout()).toBe('masonry');
  });
});
