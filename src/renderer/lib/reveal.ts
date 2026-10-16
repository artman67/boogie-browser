// Showing an item where it lives. The app's `reveal` event (an eagle:// link or the Eagle API's
// /item, /folder, /smart-folder) opens folders and selects items; showInFolder is the same jump
// from the app itself (the inspector's folder paths, "Show in its folder").
import type { MenuItem } from './contextMenu.svelte';
import { items } from './stores/items.svelte';
import { library } from './stores/library.svelte';
import { tabs } from './stores/tabs.svelte';
import { ui } from './stores/ui.svelte';
import { view } from './stores/view.svelte';
import type { BoogieEvents } from '../../shared/api';

/**
 * Open `folderId` with no search or filter and select `ids` there, scrolled into view. Back
 * returns to where you were, search included.
 */
export async function showInFolder(ids: string[], folderId: string): Promise<void> {
  if (!library.folders.has(folderId)) return void ui.toast('That folder isn’t in this library');
  ui.viewer = null;
  tabs.show(null);
  view.showUnfiltered({
    kind: 'folder',
    id: folderId,
    includeSubfolders: view.showSubfolderContents,
  });
  // Select once the new result is in: the grid starts a new view at the top, which would undo a
  // scroll made against the old result.
  await view.settled();
  ui.revealIds = ids;
}

const SHOW = 'Show in its folder';

/**
 * The "Show in its folder" menu entry for item `id`, taking `ids` along: a submenu when it is in
 * several folders. Before its full record is loaded, the entry loads it and uses the first folder.
 */
export function showInFolderMenu(id: string, ids: string[]): MenuItem {
  const full = items.full(id);
  if (!full)
    return {
      label: SHOW,
      run: async () => {
        const item = await items.loadFull(id).catch(() => null);
        const folder = item?.folders.find((f) => library.folders.has(f));
        if (folder) await showInFolder(ids, folder);
        else ui.toast('It isn’t in a folder');
      },
    };
  const folders = full.folders.filter((f) => library.folders.has(f));
  if (!folders.length) return { label: SHOW, disabled: true, title: 'It isn’t in a folder' };
  if (folders.length === 1) return { label: SHOW, run: () => showInFolder(ids, folders[0]) };
  return {
    label: SHOW,
    submenu: folders.map((f) => ({
      label: library.folder(f)!.path.join(' › '),
      run: () => showInFolder(ids, f),
    })),
  };
}

export async function revealThing({ kind, id }: BoogieEvents['reveal']): Promise<void> {
  // A link can arrive while the app is still starting (or opening the library it points into):
  // wait for the first view, so starting it doesn't undo what the link asked for.
  await library.ready;
  if (!library.state) return;
  tabs.show(null); // the item tabs stay open behind the library
  if (kind === 'folder') {
    if (!library.folders.has(id)) return void ui.toast('That folder isn’t in this library');
    return view.setScope({ kind: 'folder', id, includeSubfolders: view.showSubfolderContents });
  }
  if (kind === 'smartFolder') {
    if (!library.smartFolders.has(id))
      return void ui.toast('That smart folder isn’t in this library');
    return view.setScope({ kind: 'smartFolder', id });
  }
  const item = await items.loadFull(id).catch(() => null);
  if (!item) return void ui.toast('That item isn’t in this library');
  if (!view.result?.ids.includes(id)) {
    const folder = item.folders.find((f) => library.folders.has(f));
    if (folder && !item.isDeleted) return showInFolder([id], folder);
    view.showUnfiltered(item.isDeleted ? { kind: 'trash' } : { kind: 'all' });
    await view.settled();
  }
  ui.revealIds = [id];
}
