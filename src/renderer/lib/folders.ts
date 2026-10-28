// Finding folders by typing (the folder picker, go-to-folder, the folder fields in dialogs) and
// going to them.
// Libraries have thousands of folders (6,554 in one real library), so pickers list the best
// matches, never the whole tree.
import { rank, segments, type Segment } from '../../shared/match';
import { library } from './stores/library.svelte';
import { view } from './stores/view.svelte';
import type { FolderNode, Scope } from '../../shared/types';

export interface FolderHit {
  id: string;
  name: string;
  /** "Parent › Child" */
  path: string;
  /** The name in matched and plain runs. */
  segs: Segment[];
  /** Where it is, short: "in … › Parent" (see whereLabels). */
  where: string;
  count: number;
  /** Matched only with a typo. */
  close: boolean;
}

export const pathText = (path: string[]) => path.join(' › ');

/**
 * Folders matching `query` by the shared rules (src/shared/match.ts), best first. An empty query
 * gives the first `limit` folders in tree order.
 */
export function searchFolders(query: string, limit = 60): FolderHit[] {
  const count = (id: string) => library.counts?.folders[id]?.deep ?? 0;
  const hit = (id: string, path: string[], positions?: number[], close = false) => ({
    id,
    name: path[path.length - 1],
    path: pathText(path),
    parents: path.slice(0, -1),
    segs: segments(path[path.length - 1], positions),
    count: count(id),
    close,
  });
  const list = query.trim()
    ? rank(query, library.folders, ([id, f]) => ({
        label: f.node.name,
        parents: f.path.slice(0, -1),
        weight: count(id),
      }))
        .slice(0, limit)
        .map(({ item: [id, f], hit: h }) => hit(id, f.path, h.positions, h.close))
    : [...library.folders].slice(0, limit).map(([id, f]) => hit(id, f.path));
  const where = whereLabels(list);
  return list.map(({ parents: _, ...h }, i) => ({ ...h, where: where[i] }));
}

/**
 * A short "where is it" for each folder in a list: its parent, with "… ›" when it is deeper.
 * Folders of the same name that would read the same also show the folder where their paths part.
 */
export function whereLabels(list: { name: string; parents: string[] }[]): string[] {
  const short = (parents: string[], keep = -1): string => {
    const n = parents.length;
    if (!n) return '';
    const out: string[] = [];
    let gap = false;
    parents.forEach((p, i) => {
      if (i !== n - 1 && i !== keep) return void (gap = true);
      if (gap) out.push('…');
      out.push(p);
      gap = false;
    });
    return `in ${out.join(' › ')}`;
  };
  const plain = list.map((h) => short(h.parents));
  const groups = new Map<string, number[]>();
  list.forEach((h, i) => {
    const key = `${h.name.toLowerCase()}\n${plain[i]}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  for (const ix of groups.values()) {
    if (ix.length < 2) continue;
    for (const i of ix) {
      const mine = list[i].parents;
      // The shallowest level where this path differs from one of the others.
      let k = mine.length - 1;
      for (const j of ix) {
        if (j === i) continue;
        const theirs = list[j].parents;
        let d = 0;
        while (d < mine.length && mine[d] === theirs[d]) d++;
        k = Math.min(k, d);
      }
      plain[i] = short(mine, k);
    }
  }
  return plain;
}

/** `id` and every folder under it. */
export function subtreeIds(id: string): string[] {
  const out: string[] = [];
  const walk = (n: FolderNode) => (out.push(n.id), n.children.forEach(walk));
  const node = library.folder(id)?.node;
  if (node) walk(node);
  return out.length ? out : [id];
}

/**
 * The folders a "move" takes items out of: the folder you're looking at and, when the view shows
 * subfolder contents, every folder under it (an item on screen may live only in a subfolder).
 * Never the target, so moving into one of those subfolders still works. Empty outside a folder.
 */
export function leaveFolders(scope: Scope, targetId: string): string[] {
  if (scope.kind !== 'folder' || scope.id === targetId) return [];
  const ids = scope.includeSubfolders ? subtreeIds(scope.id) : [scope.id];
  return ids.filter((id) => id !== targetId);
}

/** The folder or one above it has an Eagle password (Eagle hides its items while locked). */
export function isLocked(id: string): boolean {
  for (let f = library.folder(id); f; f = f.parentId ? library.folder(f.parentId) : undefined)
    if (f.node.hasPassword) return true;
  return false;
}

/** Open folder `id` like any other navigation (Back returns); null opens All. */
export function goToFolder(id: string | null): void {
  view.setScope(
    id ? { kind: 'folder', id, includeSubfolders: view.showSubfolderContents } : { kind: 'all' },
  );
}

/** Folder `id`'s parent, or All for a top-level folder (Alt+Up). */
export function goUp(id: string): void {
  const f = library.folder(id);
  if (f) goToFolder(f.parentId);
}
