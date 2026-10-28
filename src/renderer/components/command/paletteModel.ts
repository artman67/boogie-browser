// What the command palette lists for a given input. Pure: the component feeds it the typed text,
// the selection size, the library's folders and tags, a preview of the keyword search and the
// enabled commands, and gets back sections of rows, each carrying what Enter (and Ctrl+Enter)
// does. Names are matched by the shared rules in src/shared/match.ts.
//
// Order: the top hit (a folder whose name you typed), the images the search finds, the other
// folders, then tags (they mostly repeat the folders), commands and libraries. Typing the start of
// a command's name puts the commands first.
import { match, queryWords, rank, segments, type Segment } from '../../../shared/match';
import { whereLabels } from '../../lib/folders';
import { quoted } from '../../lib/format';

export type PaletteAction =
  | { kind: 'search'; text: string }
  | { kind: 'clearSearch' }
  | { kind: 'addTag'; tag: string }
  | { kind: 'showTag'; tag: string }
  | { kind: 'goFolder'; id: string; folder: 'folder' | 'smartFolder' }
  | { kind: 'addToFolder'; id: string; name: string }
  | { kind: 'toggleInside'; id: string }
  | { kind: 'command'; id: string }
  | { kind: 'library'; path: string }
  | { kind: 'none' };

export interface PaletteRow {
  key: string;
  icon: string; // lucide name
  segs: Segment[];
  /** Short location after the name: "in … › Parent". */
  where?: string;
  detail?: string;
  /** Shortcut to show on the right, e.g. "Ctrl Z". */
  keys?: string;
  action: PaletteAction;
  /** Ctrl+Enter: the other thing this row can do (add the selection to it). */
  alt?: { label: string; action: PaletteAction };
  /** The full path, shown in the footer while the row is highlighted. */
  path?: string;
  /** Folders inside this one that match too (the → key lists them). */
  inside?: number;
  open?: boolean;
  /** Listed under a folder above it. */
  nested?: boolean;
  /** The top hit: drawn bigger. */
  big?: boolean;
  color?: string | null;
  /** A line of text, not something to run. */
  note?: boolean;
}

export interface PaletteSection {
  title: string;
  detail?: string;
  rows: PaletteRow[];
  /** Thumbnails under the title (the images section). */
  strip?: { id: string; url: string }[];
}

export interface Place {
  kind: 'folder' | 'smartFolder';
  id: string;
  name: string;
  /** Names of the folders above, outermost first. */
  parents: string[];
  parentId: string | null;
  count: number;
  color?: string | null;
}

export interface PaletteInput {
  text: string;
  selectionCount: number;
  canEdit: boolean;
  currentKeywords: string;
  places: Place[];
  tags: { name: string; count: number }[];
  /** The keyword search's first results, or null while there is nothing to show yet. */
  images: { total: number; thumbs: { id: string; url: string }[] } | null;
  /** The folder whose matching subfolders are listed under it. */
  expanded?: string | null;
  commands: { id: string; title: string; keys?: string[]; icon?: string }[];
  recentCommandIds: string[];
  /** The last few searches in this library, newest first (Eagle keeps 5). */
  recentSearches?: string[];
  libraries: { path: string; name: string }[];
}

const plain = (text: string): Segment => ({ text, hit: false });
const selected = (n: number) => `${n.toLocaleString()} selected`;
const items = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'item' : 'items'}`;

/** Commands worth showing before you type anything. */
const SUGGESTED = [
  'app.search',
  'filter.menu',
  'folder.goTo',
  'item.tags',
  'item.folderPicker',
  'item.rename',
  'edit.undo',
  'import.files',
  'dupes.open',
];

function commandRow(c: PaletteInput['commands'][number], positions?: number[]): PaletteRow {
  return {
    key: `cmd:${c.id}`,
    icon: c.icon ?? 'command',
    segs: segments(c.title, positions),
    keys: c.keys?.[0]?.replace(/\+/g, ' ').replace('Arrow', ''),
    action: { kind: 'command', id: c.id },
  };
}

function emptyPalette(input: PaletteInput): PaletteSection[] {
  const sections: PaletteSection[] = [];
  const add = (title: string, rows: PaletteRow[]) => rows.length && sections.push({ title, rows });
  const byId = new Map(input.commands.map((c) => [c.id, c]));
  if (input.currentKeywords) {
    add('Search', [
      {
        key: 'clear',
        icon: 'x',
        segs: [plain(`Clear search ${quoted(input.currentKeywords)}`)],
        action: { kind: 'clearSearch' },
      },
    ]);
  }
  add(
    'Recent searches',
    (input.recentSearches ?? [])
      .filter((q) => q !== input.currentKeywords)
      .slice(0, 5)
      .map((q) => ({
        key: `recentSearch:${q}`,
        icon: 'clock',
        segs: [plain(q)],
        action: { kind: 'search', text: q },
      })),
  );
  const recent = input.recentCommandIds
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .slice(0, 5);
  add(
    'Recent',
    recent.map((c) => commandRow(c)),
  );
  const shown = new Set(recent.map((c) => c.id));
  const suggested = SUGGESTED.map((id) => byId.get(id)).filter(
    (c): c is NonNullable<typeof c> => !!c && !shown.has(c.id),
  );
  for (const c of input.commands)
    if (suggested.length < 8 && c.keys?.length && !shown.has(c.id) && !suggested.includes(c))
      suggested.push(c);
  add(
    'Commands',
    suggested.slice(0, 8).map((c) => commandRow(c)),
  );
  return sections;
}

/** Folders (and smart folders) matching `text`; a match inside a matching folder goes under it. */
export function matchPlaces(text: string, places: Place[]) {
  const byId = new Map(places.map((p) => [p.id, p]));
  const hits = rank(text, places, (p) => ({ label: p.name, parents: p.parents, weight: p.count }));
  const hitIds = new Set(hits.map((h) => h.item.id));
  /** The outermost matching folder above `p`, if any. */
  const holder = (p: Place): string | null => {
    let found: string | null = null;
    for (let id = p.parentId; id; id = byId.get(id)?.parentId ?? null)
      if (hitIds.has(id)) found = id;
    return found;
  };
  const inside = new Map<string, typeof hits>();
  const top: typeof hits = [];
  for (const h of hits) {
    const at = h.item.kind === 'folder' ? holder(h.item) : null;
    if (at) inside.set(at, [...(inside.get(at) ?? []), h]);
    else top.push(h);
  }
  return { top, inside };
}

export function buildPalette(input: PaletteInput): PaletteSection[] {
  const text = input.text.trim();
  if (!text) return emptyPalette(input);
  const sections: PaletteSection[] = [];
  const add = (s: PaletteSection) => s.rows.length && sections.push(s);
  const withSel = input.selectionCount > 0 && input.canEdit;

  // ── folders and tags ──
  let { top, inside } = matchPlaces(text, input.places);
  let tags = rank(text, input.tags, (t) => ({ label: t.name, weight: t.count }));
  // Typo matches only when neither list has a real one.
  const real = top.some((h) => !h.hit.close) || tags.some((h) => !h.hit.close);
  if (real) {
    top = top.filter((h) => !h.hit.close);
    tags = tags.filter((h) => !h.hit.close);
  }
  const close = !real && (top.length > 0 || tags.length > 0);

  const placeRow = (h: (typeof top)[number], nested = false): PaletteRow => {
    const p = h.item;
    const fullPath = [...p.parents, p.name].join(' › ');
    const subs = inside.get(p.id)?.length ?? 0;
    return {
      key: `${nested ? 'in' : 'go'}:${p.id}`,
      icon: p.kind === 'smartFolder' ? 'sparkles' : 'folder',
      segs: segments(p.name, h.hit.positions),
      detail: p.count.toLocaleString(),
      action: { kind: 'goFolder', id: p.id, folder: p.kind },
      path: fullPath,
      color: p.color,
      ...(subs && !nested && { inside: subs, open: input.expanded === p.id }),
      ...(nested && { nested }),
      ...(withSel &&
        p.kind === 'folder' && {
          alt: {
            label: `Add ${selected(input.selectionCount)}`,
            action: { kind: 'addToFolder', id: p.id, name: p.name },
          },
        }),
    };
  };
  const withWhere = (rows: PaletteRow[], list: Place[]) => {
    const where = whereLabels(list);
    // A row listed under its folder needs no "in ..." line.
    rows.forEach((r, i) => (r.where = (!r.nested && where[i]) || undefined));
    return rows;
  };
  const placeRows = (list: typeof top) => {
    const rows: PaletteRow[] = [];
    const shown: Place[] = [];
    for (const h of list) {
      rows.push(placeRow(h));
      shown.push(h.item);
      if (input.expanded === h.item.id)
        for (const n of inside.get(h.item.id) ?? []) {
          rows.push(placeRow(n, true));
          shown.push(n.item);
        }
    }
    return withWhere(rows, shown);
  };

  // The top hit: a folder whose name you typed (a whole word or the start of one, each word).
  const typed = queryWords(text).length;
  const first = top[0];
  const topHit = first && !first.hit.close && first.hit.score >= 3 * typed ? first : null;
  if (topHit) {
    const rows = placeRows([topHit]);
    rows[0].big = true;
    add({ title: 'Top hit', rows });
  }

  // ── the keyword search ──
  const imgs = input.images;
  const searchRow: PaletteRow = {
    key: 'search',
    icon: 'search',
    segs:
      imgs && imgs.total > 0
        ? [plain(`Show all ${items(imgs.total)} matching ${quoted(text)}`)]
        : [plain(`Search for ${quoted(text)}`)],
    ...(imgs && imgs.total === 0 && { detail: 'No items' }),
    action: { kind: 'search', text: input.text },
    path: 'Searches names, tags, notes, links and folder names',
  };
  add({
    title: 'Images',
    detail: imgs ? items(imgs.total) : undefined,
    rows: [searchRow],
    ...(imgs?.thumbs.length && { strip: imgs.thumbs }),
  });

  // ── the rest of the folders, then tags ──
  const rest = top.filter((h) => h !== topHit).slice(0, topHit ? 4 : 5);
  const tagRows: PaletteRow[] = tags.slice(0, 3).map(({ item: t, hit }) => ({
    key: `tag:${t.name}`,
    icon: 'tag',
    segs: segments(t.name, hit.positions),
    detail: t.count.toLocaleString(),
    action: { kind: 'showTag', tag: t.name },
    ...(withSel && {
      alt: {
        label: `Add to ${selected(input.selectionCount)}`,
        action: { kind: 'addTag', tag: t.name },
      },
    }),
  }));
  const known = input.tags.some((t) => t.name.toLowerCase() === text.toLowerCase());
  if (withSel && text.length <= 60 && !known)
    tagRows.push({
      key: 'createTag',
      icon: 'tag',
      segs: [plain(`Create tag ${quoted(text)} and add to ${selected(input.selectionCount)}`)],
      action: { kind: 'addTag', tag: text },
    });
  if (close) {
    add({
      title: 'Close spelling',
      detail: `Nothing is spelled ${quoted(text)}`,
      rows: [...placeRows(rest), ...tagRows],
    });
  } else {
    add({ title: 'Folders', rows: placeRows(rest) });
    add({ title: 'Tags', rows: tagRows });
  }
  if (!top.length && !tags.length)
    add({
      title: 'Folders and tags',
      rows: [
        {
          key: 'noPlaces',
          icon: 'folder',
          segs: [plain(`No folder or tag is named ${quoted(text)}.`)],
          action: { kind: 'none' },
          note: true,
        },
      ],
    });

  // ── commands and libraries ──
  const cmds = input.commands
    .map((c) => ({ c, hit: match(text, c.title) }))
    .filter(
      (x): x is { c: (typeof input.commands)[number]; hit: NonNullable<typeof x.hit> } => !!x.hit,
    )
    .sort((a, b) => b.hit.score - a.hit.score)
    .slice(0, 6);
  add({ title: 'Commands', rows: cmds.map(({ c, hit }) => commandRow(c, hit.positions)) });
  // Typing the start of a command's name ("manage tags", "settings") means that command: list the
  // commands first so Enter runs it instead of searching the library for the words.
  const lower = text.toLowerCase();
  const named =
    lower.length >= 4 &&
    cmds.some(({ c }) => c.title.toLowerCase().replace(/…$/, '').startsWith(lower));
  if (named) {
    const i = sections.findIndex((x) => x.title === 'Commands');
    sections.unshift(...sections.splice(i, 1));
  }

  const libs = input.libraries
    .map((l) => ({ l, hit: match(text, l.name) }))
    .filter(
      (x): x is { l: (typeof input.libraries)[number]; hit: NonNullable<typeof x.hit> } => !!x.hit,
    )
    .sort((a, b) => b.hit.score - a.hit.score)
    .slice(0, 3);
  add({
    title: 'Libraries',
    rows: libs.map(({ l, hit }) => ({
      key: `lib:${l.path}`,
      icon: 'library',
      segs: [plain('Switch to '), ...segments(l.name, hit.positions)],
      action: { kind: 'library', path: l.path },
    })),
  });

  return sections;
}
