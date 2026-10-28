// Eagle's keyword grammar: space = AND, `-word` excludes, `OR` / `||`, "quoted phrases", ( ).
// A small recursive-descent parser makes an AST; `keywordsToSql` turns the AST into SQL over the
// items table with every user string bound as a parameter.
//
// Precedence: NOT binds tightest, then the implicit AND (juxtaposition), then OR:
//   a b OR c d   =   (a AND b) OR (c AND d)
// Malformed input (unbalanced quote or paren, dangling OR, empty group) degrades to a plain AND of
// the words that are left, so a half-typed query still narrows the grid instead of erroring.

import { markWords, WORD_MARK } from '../../../shared/match';
import { cleanText, frag, joinFrags, not, type SqlFrag } from './sql';

export type KeywordNode =
  /** `exact`: a "quoted phrase", matched anywhere as typed (an unquoted term starts a word). */
  | { kind: 'term'; text: string; exact?: true }
  | { kind: 'and'; children: KeywordNode[] }
  | { kind: 'or'; children: KeywordNode[] }
  | { kind: 'not'; child: KeywordNode };

type Token =
  { t: 'word'; v: string; exact?: true } | { t: 'lp' } | { t: 'rp' } | { t: 'or' } | { t: 'neg' };

class ParseError extends Error {}

const isSpace = (c: string): boolean => /\s/.test(c);

/** Curly quotes from phone keyboards and word processors count as plain quotes. NULs go (see cleanText). */
const normalizeQuotes = (s: string): string => cleanText(s).replace(/[“”„‟«»]/g, '"');

function tokenize(input: string): Token[] {
  const s = normalizeQuotes(input);
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (isSpace(c)) {
      i++;
    } else if (c === '(') {
      out.push({ t: 'lp' });
      i++;
    } else if (c === ')') {
      out.push({ t: 'rp' });
      i++;
    } else if (c === '|' && s[i + 1] === '|') {
      out.push({ t: 'or' });
      i += 2;
    } else if (c === '"') {
      const end = s.indexOf('"', i + 1);
      if (end === -1) throw new ParseError('unbalanced quote');
      const phrase = s
        .slice(i + 1, end)
        .replace(/\s+/g, ' ')
        .trim();
      if (phrase) out.push({ t: 'word', v: phrase, exact: true });
      i = end + 1;
    } else if (
      c === '-' &&
      i + 1 < s.length &&
      !isSpace(s[i + 1]) &&
      s[i + 1] !== ')' &&
      out[out.length - 1]?.t !== 'neg'
    ) {
      out.push({ t: 'neg' });
      i++;
    } else {
      let j = i;
      while (
        j < s.length &&
        !isSpace(s[j]) &&
        s[j] !== '(' &&
        s[j] !== ')' &&
        s[j] !== '"' &&
        !(s[j] === '|' && s[j + 1] === '|')
      )
        j++;
      const word = s.slice(i, j);
      i = j;
      if (word === '-') continue; // a lone dash excludes nothing
      // Eagle accepts `or` in any case as the operator.
      out.push(word.toUpperCase() === 'OR' ? { t: 'or' } : { t: 'word', v: word });
    }
  }
  return out;
}

function parseTokens(tokens: Token[]): KeywordNode | null {
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];

  const parseOr = (): KeywordNode => {
    const parts = [parseAnd()];
    while (peek()?.t === 'or') {
      pos++;
      parts.push(parseAnd());
    }
    return parts.length === 1 ? parts[0] : { kind: 'or', children: parts };
  };

  const parseAnd = (): KeywordNode => {
    const parts: KeywordNode[] = [];
    for (let t = peek(); t && t.t !== 'or' && t.t !== 'rp'; t = peek()) parts.push(parseUnary());
    if (parts.length === 0) throw new ParseError('empty side');
    return parts.length === 1 ? parts[0] : { kind: 'and', children: parts };
  };

  const parseUnary = (): KeywordNode => {
    const t = peek();
    if (!t) throw new ParseError('unexpected end');
    if (t.t === 'neg') {
      pos++;
      return { kind: 'not', child: parseUnary() };
    }
    if (t.t === 'lp') {
      pos++;
      const inner = parseOr();
      if (peek()?.t !== 'rp') throw new ParseError('unbalanced paren');
      pos++;
      return inner;
    }
    if (t.t === 'word') {
      pos++;
      return t.exact ? { kind: 'term', text: t.v, exact: true } : { kind: 'term', text: t.v };
    }
    throw new ParseError('unexpected token');
  };

  if (tokens.length === 0) return null;
  const node = parseOr();
  if (pos < tokens.length) throw new ParseError('unbalanced paren'); // a stray ')'
  return node;
}

/**
 * The fallback: every remaining word ANDed, `-word` still excludes, brackets, quotes and `||`
 * dropped. A dangling OR is dropped too (so `cat OR` narrows to `cat` while you type the rest),
 * unless it is all there is: then it is the word "or".
 */
function plainWords(input: string): KeywordNode | null {
  const raw = normalizeQuotes(input)
    .replace(/\|\|/g, ' ')
    .replace(/[()"]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const words = raw.filter((w) => w.toUpperCase() !== 'OR');
  const nodes: KeywordNode[] = [];
  for (const w of words.length ? words : raw) {
    if (w.startsWith('-') && w.length > 1)
      nodes.push({ kind: 'not', child: { kind: 'term', text: w.slice(1) } });
    else if (w !== '-') nodes.push({ kind: 'term', text: w });
  }
  if (nodes.length === 0) return null;
  return nodes.length === 1 ? nodes[0] : { kind: 'and', children: nodes };
}

/** null when the text holds nothing to search for. Never throws. */
export function parseKeywords(input: string): KeywordNode | null {
  if (typeof input !== 'string' || !cleanText(input).trim()) return null;
  try {
    return parseTokens(tokenize(input));
  } catch (err) {
    if (err instanceof ParseError) return plainWords(input);
    throw err;
  }
}

// ── SQL ──

/**
 * 'words': an unquoted term matches the start of a word ("arm" finds "Arm of Eve" and "armchair",
 * not "Charmoy"). 'partial': every term matches anywhere, as Eagle does (the fallback when a
 * search finds nothing by word starts).
 */
export type KeywordMode = 'words' | 'partial';

const codepoints = (s: string): number => [...s].length;

/** FTS5 phrase syntax: wrap in double quotes, double the quotes inside. */
const ftsPhrase = (s: string): string => `"${s.replace(/"/g, '""')}"`;

// Scripts written without spaces have no word starts to look for: their terms match anywhere.
const UNSPACED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

/**
 * The term as item_search holds it when it has to start a word (WORD_MARK before each word, the
 * text lowercased), or null when it matches anywhere: a "quoted phrase", the partial mode, an
 * unspaced script, or a term with no letters or digits.
 */
export function wordForm(
  term: string,
  exact: boolean | undefined,
  mode: KeywordMode,
): string | null {
  if (mode !== 'words' || exact || UNSPACED.test(term)) return null;
  const marked = markWords(term);
  return marked.includes(WORD_MARK) ? marked : null;
}

function leafSql(text: string, word: string | null): SqlFrag {
  let match: SqlFrag;
  if (codepoints(text) >= 3) {
    // trigram FTS: case-insensitive substring over everything Eagle's keyword search covers (name,
    // tags, note, url, comments, folder names and descriptions, ext). For a word start, its hits
    // are the candidates and item_search's marked text says which have the term at a word start.
    match = word
      ? frag(
          `i.rowid IN (SELECT s.item_rowid FROM items_fts f JOIN item_search s ON s.item_rowid = f.rowid
            WHERE items_fts MATCH ? AND instr(s.text, ?) > 0)`,
          ftsPhrase(text),
          word,
        )
      : frag('i.rowid IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)', ftsPhrase(text));
  } else {
    // Under 3 characters the trigram index can't help: scan item_search, the same fields lowercased
    // with JS toLowerCase (so a typed "é" finds "École"; the term never holds a field or list
    // separator, so it can't match across two fields or two tags) and with WORD_MARK before every
    // word (dropped again to match anywhere).
    match = word
      ? frag('i.rowid IN (SELECT item_rowid FROM item_search WHERE instr(text, ?) > 0)', word)
      : frag(
          "i.rowid IN (SELECT item_rowid FROM item_search WHERE instr(replace(text, char(1), ''), ?) > 0)",
          text.toLowerCase(),
        );
  }
  // ".png" is how people type an extension; the ext column holds "png".
  if (text.startsWith('.') && text.length > 1)
    return frag(
      `(${match.sql} OR instr(i.ext, ?) > 0)`,
      ...match.params,
      text.slice(1).toLowerCase(),
    );
  return match;
}

/** Library names are sometimes NFD and what people type is NFC (or the reverse): try both forms. */
function termSql(text: string, exact: boolean | undefined, mode: KeywordMode): SqlFrag {
  const forms = [...new Set([text.normalize('NFC'), text.normalize('NFD')])];
  return joinFrags(
    forms.map((f) => leafSql(f, wordForm(f, exact, mode))),
    'OR',
  );
}

/** Every fragment evaluates to 0 or 1, never NULL, so NOT is safe. */
export function keywordsToSql(node: KeywordNode, mode: KeywordMode = 'words'): SqlFrag {
  switch (node.kind) {
    case 'term':
      return termSql(node.text, node.exact, mode);
    case 'not':
      return not(keywordsToSql(node.child, mode));
    case 'and':
    case 'or':
      return joinFrags(
        node.children.map((c) => keywordsToSql(c, mode)),
        node.kind === 'and' ? 'AND' : 'OR',
      );
  }
}

/** The plain-text terms a query looks for (used by tests and by callers that highlight matches). */
export function keywordTerms(node: KeywordNode | null): string[] {
  return positiveTerms(node).map((t) => t.text);
}

export type KeywordTerm = Extract<KeywordNode, { kind: 'term' }>;

/** The terms a query looks for, not the ones it excludes. */
export function positiveTerms(node: KeywordNode | null): KeywordTerm[] {
  if (!node) return [];
  if (node.kind === 'term') return [node];
  if (node.kind === 'not') return [];
  return node.children.flatMap(positiveTerms);
}
