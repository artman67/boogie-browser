// A query that also asks for pictures that look like its words (QueryRequest.looksLike): the
// keyword results as usual, then a 'looks' section of the scope's other pictures, best first.
import {
  LOOKS_PER_FOLDER,
  type QueryRequest,
  type QueryResult,
  type ResultSection,
} from '../../shared/types';
import { parseKeywords, positiveTerms } from '../index/query/keywords';
import type { Looks } from '../looks';
import type { Session } from './types';

type Stacks = NonNullable<QueryResult['looksStacks']>;

export async function queryWithLooks(
  s: Session,
  looks: Looks,
  req: QueryRequest,
): Promise<QueryResult> {
  // The words to look for, without the search syntax (-excluded words, OR, quotes).
  const text = positiveTerms(parseKeywords(req.looksLike ?? ''))
    .map((t) => t.text)
    .join(' ');
  if (!text) return s.query.query(req);
  const t0 = performance.now();
  const { keywords, ...others } = req.filter;
  const base = keywords?.trim() ? s.query.query(req) : null;
  // Every picture the scope and the other filters allow.
  const pool = s.query.query({ scope: req.scope, filter: others, sort: null });
  const found = await looks.rank(s.ref.id, text, pool.ids, new Set(base?.ids));
  const aspect = new Map(pool.ids.map((id, k) => [id, pool.aspects[k]]));
  // The folder being looked in is never folded: everything there is in it.
  const inside = req.scope.kind === 'folder' ? req.scope.id : null;
  const shown = req.looksByFolder
    ? byFolder(found.ids, folderOf(s, found.ids, inside), new Set(req.looksOpen))
    : { ids: found.ids, stacks: null };

  const head: QueryResult = base ?? {
    total: 0,
    ids: [],
    aspects: [],
    sort: pool.sort,
    elapsedMs: 0,
  };
  // The words' own matches get a heading of their own only when there are some.
  const sections: ResultSection[] | undefined = shown.ids.length
    ? [
        ...(head.sections ?? (head.ids.length ? [{ start: 0, kind: 'here' as const }] : [])),
        { start: head.ids.length, kind: 'looks' },
      ]
    : head.sections;
  return {
    ...head,
    // Without words, the pictures that look like them are the scope's own results.
    total: base ? head.total : found.ids.length,
    ids: head.ids.concat(shown.ids),
    aspects: head.aspects.concat(shown.ids.map((id) => aspect.get(id) ?? 1)),
    elapsedMs: Math.round((performance.now() - t0) * 10) / 10,
    ...(sections && { sections }),
    looksPending: found.pending,
    looksTotal: found.ids.length,
    ...(shown.stacks && { looksStacks: shown.stacks }),
  };
}

/** A folder for each picture that is in one (the first by id when in several), but `inside`. */
function folderOf(s: Session, ids: string[], inside: string | null): Map<string, string> {
  const rows = s.index.db
    .prepare(
      `SELECT i.id, MIN(f.folder_id) FROM items i JOIN item_folders f ON f.item_rowid = i.rowid
       WHERE i.id IN (SELECT value FROM json_each(?)) GROUP BY i.id`,
    )
    .raw()
    .all(JSON.stringify(ids)) as [string, string][];
  return new Map(rows.filter(([, f]) => f !== inside));
}

/**
 * Each folder's best `keep` pictures where they rank; the folder's next one stands for the rest of
 * it (a stack), or, when the folder is open, the rest all follow there. Pictures in no folder are
 * never folded.
 */
export function byFolder(
  ids: string[],
  folderOf: ReadonlyMap<string, string>,
  open: ReadonlySet<string>,
  keep = LOOKS_PER_FOLDER,
): { ids: string[]; stacks: Stacks } {
  const members = new Map<string, string[]>();
  for (const id of ids) {
    const f = folderOf.get(id);
    if (!f) continue;
    const m = members.get(f);
    if (m) m.push(id);
    else members.set(f, [id]);
  }
  const out: string[] = [];
  const stacks: Stacks = {};
  const seen = new Map<string, number>();
  for (const id of ids) {
    const f = folderOf.get(id);
    const n = f ? (seen.get(f) ?? 0) + 1 : 0;
    if (f) seen.set(f, n);
    if (!f || n <= keep) out.push(id);
    else if (n === keep + 1) {
      const rest = members.get(f)!.slice(keep);
      if (open.has(f)) out.push(...rest);
      else {
        out.push(id);
        // A stack of one is just the picture.
        if (rest.length > 1) stacks[id] = { folderId: f, count: rest.length };
      }
    }
  }
  return { ids: out, stacks };
}
