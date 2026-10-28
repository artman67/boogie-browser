// Suggestions for the tag inputs and the folder fields, matched and ranked by the shared rules in
// src/shared/match.ts (words, not scattered letters; one typo only when nothing else matches). A
// folder matches through the folders above it too ("art kit" finds "Art / Kitchen mixups"), and a
// bigger folder (items in it and under it) wins a tie.
import type Database from 'better-sqlite3';
import type { EagleSmartFolderRecord, TagInfo } from '../../../shared/types';
import { rank } from '../../../shared/match';
import { flattenSmartFolders } from './smartFolders';

export type SuggestKind = 'tag' | 'folder' | 'smartFolder';

export interface SuggestEntry {
  kind: SuggestKind;
  id: string;
  label: string;
  path: string;
  count: number;
  /** Names of the folders above, outermost first. */
  parents: string[];
}

export function rankSuggestions(
  entries: SuggestEntry[],
  text: string,
  limit: number,
): Omit<SuggestEntry, 'parents'>[] {
  const n = Math.max(0, limit);
  const list = text.trim()
    ? rank(text, entries, (e) => ({ label: e.label, parents: e.parents, weight: e.count }), n).map(
        (r) => r.item,
      )
    : [...entries].sort((a, b) => b.count - a.count).slice(0, n);
  return list.map(({ parents: _, ...e }) => e);
}

// ───────────────────────── corpora ─────────────────────────

/** Tags from index.tags(): live counts plus tags that only live in a tag group (count 0). */
export function tagEntries(tags: TagInfo[]): SuggestEntry[] {
  return tags.map((t) => ({
    kind: 'tag',
    id: t.name,
    label: t.name,
    path: '',
    count: t.count,
    parents: [],
  }));
}

/** Every folder with its "Parent / Child" path and the live items in it and under it. */
export function folderEntries(db: Database.Database): SuggestEntry[] {
  const counts = new Map<string, number>();
  for (const r of db
    .prepare(
      `SELECT c.ancestor_id AS id, COUNT(DISTINCT f.item_rowid) AS n FROM folder_closure c
       JOIN item_folders f ON f.folder_id = c.descendant_id
       JOIN items i ON i.rowid = f.item_rowid WHERE i.is_deleted = 0 GROUP BY c.ancestor_id`,
    )
    .all() as { id: string; n: number }[]) {
    counts.set(r.id, r.n);
  }
  const rows = db.prepare('SELECT id, parent_id, name, path FROM folders').all() as {
    id: string;
    parent_id: string | null;
    name: string;
    path: string;
  }[];
  const byId = new Map(rows.map((f) => [f.id, f]));
  const parentsOf = (f: (typeof rows)[number]): string[] => {
    const out: string[] = [];
    for (let p = f.parent_id ? byId.get(f.parent_id) : undefined; p;) {
      out.unshift(p.name);
      p = p.parent_id ? byId.get(p.parent_id) : undefined;
    }
    return out;
  };
  return rows.map((f) => ({
    kind: 'folder',
    id: f.id,
    label: f.name,
    path: f.path,
    count: counts.get(f.id) ?? 0,
    parents: parentsOf(f),
  }));
}

export function smartFolderEntries(
  tree: EagleSmartFolderRecord[],
  counts: Record<string, number>,
): SuggestEntry[] {
  return flattenSmartFolders(tree).map(({ node, path, ancestors }) => ({
    kind: 'smartFolder',
    id: node.id,
    label: String(node.name ?? ''),
    path,
    count: counts[node.id] ?? 0,
    parents: ancestors.map((a) => String(a.name ?? '')),
  }));
}
