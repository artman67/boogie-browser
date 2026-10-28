// Finding things by name as you type: one set of rules for every search box (the command palette,
// the folder pickers, the tag inputs, the sidebar filter) and the word marks the keyword search
// uses. Each word you type has to match a word in the name; letters scattered across a name never
// count. From best to worst, a typed word matches:
//   a whole word ("zorn" in "Anders Zorn"), the start of a word ("sarg"), the initials of the name
//   ("jss" for "John Singer Sargent"), or, with 4+ letters, the inside of a word ("sargent" in
//   "sargentnotes"). One typo is allowed only when nothing in the list matches without one.
// Words split at spaces and punctuation, at a lower-to-UPPER hump ("DraperyDrawing") and between
// letters and digits ("8Sargent"). Case and accents don't matter.

/** One word of a label: its folded text and, per folded character, where it is in the label. */
export interface Word {
  text: string;
  at: number[];
}

const MARK = /\p{M}/u;
const ALNUM = /[\p{L}\p{N}]/u;
const DIGIT = /\p{N}/u;
const LOWER = /\p{Ll}/u;
const UPPER = /\p{Lu}/u;
// Scripts written without spaces: any run inside a word is a fair match.
const UNSPACED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

const foldChar = (c: string): string =>
  c
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();

/** Case and accents folded away. */
export const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();

const wordCache = new Map<string, Word[]>();

export function words(label: string): Word[] {
  const hit = wordCache.get(label);
  if (hit) return hit;
  const out: Word[] = [];
  let cur: Word | null = null;
  let prev = '';
  for (let i = 0; i < label.length;) {
    const ch = String.fromCodePoint(label.codePointAt(i)!);
    if (MARK.test(ch) && cur) {
      i += ch.length; // a combining accent belongs to the letter before it
      continue;
    }
    if (!ALNUM.test(ch)) {
      cur = null;
    } else {
      const hump = (LOWER.test(prev) && UPPER.test(ch)) || DIGIT.test(prev) !== DIGIT.test(ch);
      if (!cur || hump) out.push((cur = { text: '', at: [] }));
      for (const f of foldChar(ch)) {
        cur.text += f;
        cur.at.push(i);
      }
    }
    prev = ch;
    i += ch.length;
  }
  if (wordCache.size > 50_000) wordCache.clear();
  wordCache.set(label, out);
  return out;
}

/** The typed words, folded. */
export const queryWords = (query: string): string[] => words(query).map((w) => w.text);

/** One letter added, dropped, changed, or two neighbours swapped. */
function oneTypo(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return (
    a.slice(i + 1) === b.slice(i + 1) ||
    a.slice(i) === b.slice(i + 1) ||
    a.slice(i + 1) === b.slice(i) ||
    (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
  );
}

const WHOLE = 4;
const START = 3;
const INITIALS = 2;
const INSIDE = 1;
const TYPO = 0.5;

/** How one typed word matches a label's words: its score and the label positions it covers. */
function matchWord(
  t: string,
  ws: Word[],
  typos: boolean,
): { score: number; at: number[]; word: number } | null {
  let best: { score: number; at: number[]; word: number } | null = null;
  const take = (score: number, at: number[], word: number) => {
    if (!best || score > best.score) best = { score, at, word };
  };
  ws.forEach((w, k) => {
    if (w.text === t) take(WHOLE, w.at, k);
    else if (w.text.startsWith(t)) take(START, w.at.slice(0, t.length), k);
  });
  if (best) return best;
  const joined = ws.map((w) => w.text).join('');
  const atAll = () => ws.flatMap((w) => w.at);
  // From the start of a word on into the next ones, typed without the break ("iph" for
  // "iPhone", "draperydraw" for "DraperyDrawing").
  for (let k = 0, from = 0; k < ws.length; from += ws[k++].text.length)
    if (joined.startsWith(t, from))
      return { score: START, at: atAll().slice(from, from + t.length), word: k };
  // Inside a word, or across words run together ("sargentnotes"), with 4+ letters.
  if (t.length >= 4 || UNSPACED.test(t)) {
    const from = joined.indexOf(t);
    if (from >= 0) {
      let k = 0;
      for (let n = 0; k < ws.length && n + ws[k].text.length <= from; k++) n += ws[k].text.length;
      return { score: INSIDE, at: atAll().slice(from, from + t.length), word: k };
    }
  }
  if (typos && t.length >= 5)
    ws.forEach((w, k) => {
      if (w.text.length >= 4 && oneTypo(t, w.text)) take(TYPO, w.at, k);
    });
  return best;
}

export interface Hit {
  /** Higher is better: the match type of each typed word, added up. */
  score: number;
  /** How much of the name the typed words cover, 0 to 1 ("Mucha" beats "Mucha Foundation"). */
  cover: number;
  /** Matched only with a typo. */
  close: boolean;
  /** Matched characters of the label (UTF-16 indexes, ascending), for highlighting. */
  positions: number[];
}

export interface MatchOptions {
  /** Names of the folders above (outermost first): typed words may match these too. */
  parents?: string[];
  typos?: boolean;
}

/**
 * How `query` matches `label`, or null. With `parents`, each typed word may match the label or a
 * folder above it, but at least one must match the label itself ("sargent drawing" finds the
 * folder "sargent drawing" inside "John Singer Sargent").
 */
export function match(query: string, label: string, opts: MatchOptions = {}): Hit | null {
  const typed = queryWords(query);
  if (!typed.length) return null;
  const own = words(label);
  if (!own.length) return null;
  const typos = !!opts.typos;
  let up: Word[] | null = null;
  let score = 0;
  let close = false;
  const positions: number[] = [];
  const covered = new Set<number>();
  let regular = true;
  for (const t of typed) {
    const m = matchWord(t, own, typos);
    if (m) {
      score += m.score;
      close ||= m.score === TYPO;
      positions.push(...m.at);
      covered.add(m.word);
      continue;
    }
    up ??= (opts.parents ?? []).flatMap((p) => words(p));
    const p = matchWord(t, up, typos);
    if (!p) {
      regular = false;
      break;
    }
    score += p.score / 2;
    close ||= p.score === TYPO;
  }
  if (regular && covered.size) {
    return {
      score,
      cover: covered.size / own.length,
      close,
      positions: [...new Set(positions)].sort((a, b) => a - b),
    };
  }
  // Initials: "jss" for John Singer Sargent.
  const t = typed.join('');
  if (typed.length === 1 && t.length >= 2 && t.length <= 5 && own.length >= t.length) {
    if (own.every((w, k) => k >= t.length || w.text[0] === t[k]))
      return {
        score: INITIALS,
        cover: t.length / own.length,
        close: false,
        positions: own.slice(0, t.length).map((w) => w.at[0]),
      };
  }
  return null;
}

export interface Candidate {
  label: string;
  parents?: string[];
  /** Bigger first among equal matches (item counts). */
  weight?: number;
}

export interface Ranked<T> {
  item: T;
  hit: Hit;
}

/**
 * The items matching `query`, best first: better match, then the whole name typed, then the
 * bigger weight, then fewer folders deep, then the shorter name. When nothing matches as typed,
 * the items one typo away (their hits say `close`).
 */
export function rank<T>(
  query: string,
  items: Iterable<T>,
  candidate: (item: T) => Candidate,
  limit = Infinity,
): Ranked<T>[] {
  const list = [...items];
  const run = (typos: boolean) => {
    const out: (Ranked<T> & { c: Candidate })[] = [];
    for (const item of list) {
      const c = candidate(item);
      const hit = match(query, c.label, { parents: c.parents, typos });
      if (hit) out.push({ item, hit, c });
    }
    return out;
  };
  let hits = run(false);
  if (!hits.length) hits = run(true);
  hits.sort(
    (a, b) =>
      b.hit.score - a.hit.score ||
      Number(b.hit.cover === 1) - Number(a.hit.cover === 1) ||
      (b.c.weight ?? 0) - (a.c.weight ?? 0) ||
      (a.c.parents?.length ?? 0) - (b.c.parents?.length ?? 0) ||
      a.c.label.length - b.c.label.length ||
      a.c.label.localeCompare(b.c.label),
  );
  return hits.slice(0, limit).map(({ item, hit }) => ({ item, hit }));
}

/** Matched or not, run by run, for drawing a label with its matched characters marked. */
export interface Segment {
  text: string;
  hit: boolean;
}

export function segments(text: string, positions: number[] | undefined): Segment[] {
  if (!positions?.length) return [{ text, hit: false }];
  const hits = new Set(positions);
  const out: Segment[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = hits.has(i);
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else out.push({ text: text[i], hit });
  }
  return out;
}

/**
 * The keyword search's form of a text: folded per character (lowercased only, like the search
 * index), with WORD_MARK in front of every word, so "a word that starts with arm" is a plain
 * substring test for WORD_MARK + "arm". Lines stay lines (the index keeps one field per line).
 */
export const WORD_MARK = '\u0001';

export function markWords(text: string): string {
  let out = '';
  let prev = '';
  let inWord = false;
  for (let i = 0; i < text.length;) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    i += ch.length;
    if (ALNUM.test(ch)) {
      const hump = (LOWER.test(prev) && UPPER.test(ch)) || DIGIT.test(prev) !== DIGIT.test(ch);
      if (!inWord || hump) out += WORD_MARK;
      inWord = true;
    } else if (!(MARK.test(ch) && inWord)) {
      inWord = false;
    }
    out += ch === WORD_MARK ? '' : ch.toLowerCase();
    prev = ch;
  }
  return out;
}
