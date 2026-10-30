// A query that also asks for pictures that look like its words (QueryRequest.looksLike): the
// keyword results as usual, then a 'looks' section of the scope's other pictures, best first.
import type { QueryRequest, QueryResult, ResultSection } from '../../shared/types';
import { parseKeywords, positiveTerms } from '../index/query/keywords';
import type { Looks } from '../looks';
import type { Session } from './types';

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

  const head: QueryResult = base ?? {
    total: 0,
    ids: [],
    aspects: [],
    sort: pool.sort,
    elapsedMs: 0,
  };
  // The words' own matches get a heading of their own only when there are some.
  const sections: ResultSection[] | undefined = found.ids.length
    ? [
        ...(head.sections ?? (head.ids.length ? [{ start: 0, kind: 'here' as const }] : [])),
        { start: head.ids.length, kind: 'looks' },
      ]
    : head.sections;
  return {
    ...head,
    // Without words, the pictures that look like them are the scope's own results.
    total: base ? head.total : found.ids.length,
    ids: head.ids.concat(found.ids),
    aspects: head.aspects.concat(found.ids.map((id) => aspect.get(id) ?? 1)),
    elapsedMs: Math.round((performance.now() - t0) * 10) / 10,
    ...(sections && { sections }),
    looksPending: found.pending,
  };
}
