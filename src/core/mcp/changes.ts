// Change lists: the exact before/after an agent sees in a dry run. Pure functions, no I/O.
// Batch rename and duplicate merge use the app's own rules (service/rename.ts, dupes planMerge),
// so a dry run can never show something different from what gets applied.
import type { EagleItemRecord, Item, ItemPatch } from '../../shared/types';
import { planMerge } from '../dupes';
import { expandRenameTemplate, type RenameOptions } from '../service/rename';
import type { FolderIndex } from './folders';
import { uniq } from './kit';

export interface Change {
  /** Item id, or the folder/tag/path the change is about. */
  id: string;
  name: string;
  field: string;
  before: unknown;
  after: unknown;
  /** The item is in the trash: taking it out of folders changes nothing the user sees. */
  in_trash?: true;
}

export const CHANGES_SHOWN = 20;
const GROUPS_SHOWN = 10;
const EXAMPLES = 3;
const CLIP = 200;

const clip = (v: unknown): unknown =>
  typeof v === 'string' && v.length > CLIP ? v.slice(0, CLIP) + '...' : v;

export const clipped = (c: Change): Change => ({
  ...c,
  before: clip(c.before),
  after: clip(c.after),
});

interface Group {
  field: string;
  before: unknown;
  after: unknown;
  count: number;
  examples: string[];
}

/** Rows that make the same change (same field, before and after) folded into one line each. */
function groupChanges(changes: Change[]): Group[] {
  const groups = new Map<string, Group>();
  for (const c of changes) {
    const key = JSON.stringify([c.field, c.before, c.after, c.in_trash ?? false]);
    let g = groups.get(key);
    if (!g)
      groups.set(
        key,
        (g = { field: c.field, before: c.before, after: c.after, count: 0, examples: [] }),
      );
    g.count++;
    if (g.examples.length < EXAMPLES) g.examples.push(c.name);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

const isList = (v: unknown): v is unknown[] => Array.isArray(v);

/**
 * Live items a change takes out of their last folder. This is the question to answer before
 * removing folders: those items end up uncategorized (not deleted, but easy to lose track of).
 */
function leftInNoFolder(changes: Change[]): { count: number; examples: string[] } | null {
  let removes = false;
  const left: string[] = [];
  for (const c of changes) {
    if (c.field !== 'folders' || !isList(c.before) || !isList(c.after)) continue;
    if (c.after.length >= c.before.length) continue;
    removes = true;
    if (c.after.length === 0 && !c.in_trash) left.push(c.name);
  }
  return removes ? { count: left.length, examples: left.slice(0, 5) } : null;
}

/**
 * What the agent is shown: the first rows, the rows folded into groups when there are more, and
 * how many items would be left in no folder. The digest uses the full list; plan_changes pages it.
 */
export function displayChanges(changes: Change[]): Record<string, unknown> {
  const truncated = changes.length > CHANGES_SHOWN;
  const groups = truncated ? groupChanges(changes) : [];
  const left = leftInNoFolder(changes);
  return {
    changes: changes.slice(0, CHANGES_SHOWN).map(clipped),
    changes_total: changes.length,
    changes_truncated: truncated,
    // Only worth showing when it folds something: a list of one-row groups repeats the rows.
    ...(groups.length && groups.length < changes.length
      ? {
          change_groups: groups
            .slice(0, GROUPS_SHOWN)
            .map((g) => ({ ...g, before: clip(g.before), after: clip(g.after) })),
          change_groups_total: groups.length,
        }
      : {}),
    ...(left
      ? {
          left_in_no_folder: left.count,
          ...(left.count ? { left_in_no_folder_examples: left.examples } : {}),
        }
      : {}),
    ...(truncated
      ? { more_changes: 'plan_changes with this plan_id lists every row (offset, limit).' }
      : {}),
  };
}

const sameList = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Adds a change to `out` only when before and after differ (lists compare in order). */
function recorder(out: Change[], item: Item) {
  return (field: string, before: unknown, after: unknown) => {
    const same =
      Array.isArray(before) && Array.isArray(after) ? sameList(before, after) : before === after;
    if (same) return;
    out.push({
      id: item.id,
      name: item.name,
      field,
      before,
      after,
      ...(item.isDeleted ? { in_trash: true as const } : {}),
    });
  };
}

/**
 * The per-item changes an ItemPatch would make. Mirrors what CoreApi.updateItems does: setX wins over
 * addX/removeX, and adding to a folder also adds that folder's auto-tags (own and ancestors').
 * No-ops are left out so a re-run of an already applied change is "nothing to do".
 */
export function diffPatch(item: Item, patch: ItemPatch, folders: FolderIndex): Change[] {
  const out: Change[] = [];
  const push = recorder(out, item);

  if (patch.name !== undefined) push('name', item.name, patch.name);

  let folderIds = item.folders;
  if (patch.setFolders) folderIds = uniq(patch.setFolders);
  else {
    if (patch.removeFolders) folderIds = folderIds.filter((f) => !patch.removeFolders!.includes(f));
    if (patch.addFolders) folderIds = uniq([...folderIds, ...patch.addFolders]);
  }
  push(
    'folders',
    item.folders.map((f) => folders.pathOf(f)),
    folderIds.map((f) => folders.pathOf(f)),
  );

  let tags = item.tags;
  if (patch.setTags) tags = uniq(patch.setTags);
  else {
    if (patch.removeTags) tags = tags.filter((t) => !patch.removeTags!.includes(t));
    if (patch.addTags) tags = uniq([...tags, ...patch.addTags]);
  }
  const addedFolders = (patch.addFolders ?? []).filter((f) => !item.folders.includes(f));
  if (addedFolders.length)
    tags = uniq([...tags, ...addedFolders.flatMap((f) => folders.autoTags(f))]);
  push('tags', item.tags, tags);

  if (patch.star !== undefined) push('rating', item.star, patch.star);
  if (patch.annotation !== undefined) push('note', item.annotation, patch.annotation);
  if (patch.url !== undefined) push('url', item.url, patch.url);
  return out;
}

/** The names batch rename gives these items, in this order (before the adapter makes them filename-safe). */
export function previewRename(items: Item[], template: string, opts: RenameOptions): string[] {
  const sources = items.map((i) => ({ name: i.name, tags: i.tags, importedAt: i.importedAt }));
  // The service trims each name before writing it, and skips empty ones.
  return expandRenameTemplate(template, sources, opts).map((n) => n.trim());
}

/** The record fields merge planning reads, from what the query engine returns. */
function asRecord(i: Item): EagleItemRecord {
  return {
    id: i.id,
    name: i.name,
    size: i.size,
    btime: i.btime,
    mtime: i.mtime,
    ext: i.ext,
    tags: [...i.tags],
    folders: [...i.folders],
    isDeleted: i.isDeleted,
    url: i.url,
    annotation: i.annotation,
    modificationTime: i.importedAt,
    ...(i.star ? { star: i.star } : {}),
    order: { ...i.order },
  };
}

/** The keeper's side of a duplicate merge (the app's own planMerge), and the ids it would trash. */
export function previewMerge(
  keeper: Item,
  others: Item[],
  folders: FolderIndex,
): { changes: Change[]; trashIds: string[] } {
  const rec = asRecord(keeper);
  const plan = planMerge(
    rec,
    others.map(asRecord),
    { keeperId: keeper.id, otherIds: others.map((o) => o.id) },
    (id) => folders.autoTags(id),
  );
  plan.keeper(rec);
  const out: Change[] = [];
  const push = recorder(out, keeper);
  push('tags', keeper.tags, rec.tags);
  push(
    'folders',
    keeper.folders.map((f) => folders.pathOf(f)),
    rec.folders.map((f) => folders.pathOf(f)),
  );
  push('rating', keeper.star, rec.star ?? 0);
  push('url', keeper.url, rec.url);
  push('note', keeper.annotation, rec.annotation);
  return { changes: out, trashIds: plan.trashIds };
}
