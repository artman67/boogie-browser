// What the tab row's right-click menus offer.
import { openContextMenu, type MenuItem } from '../../lib/contextMenu.svelte';
import { revealThing } from '../../lib/reveal';
import { around, tabItem, tabs } from '../../lib/stores/tabs.svelte';
import { api } from '../../lib/api';
import { fail } from '../../lib/edit';
import { popOut } from '../viewer/actions';

const reopen = (): MenuItem => ({
  label: 'Reopen closed tab',
  keys: 'Ctrl Shift T',
  disabled: !tabs.canReopen,
  run: () => tabs.reopen(),
});

export function tabMenu(e: MouseEvent, key: string): void {
  const t = tabs.get(key);
  if (!t) return;
  const id = tabItem(t);
  openContextMenu(e, [
    { label: 'Pop out into its own window', run: () => popOut(key) },
    {
      label: 'Open in reference window',
      run: () =>
        api.openReferenceWindow(id, around(t.ids, t.index, 2000).ids).catch((err) => fail(err)),
    },
    {
      label: 'Show in library',
      run: () => (tabs.show(null), revealThing({ kind: 'item', id })),
    },
    { separator: true },
    { label: 'Close tab', keys: 'Ctrl W', run: () => tabs.close(key) },
    {
      label: 'Close other tabs',
      disabled: tabs.list.length < 2,
      run: () => tabs.closeOthers(key),
    },
    reopen(),
  ]);
}

export function libraryTabMenu(e: MouseEvent): void {
  openContextMenu(e, [
    { label: 'Close all item tabs', run: () => tabs.list.forEach((t) => tabs.close(t.key)) },
    reopen(),
  ]);
}
