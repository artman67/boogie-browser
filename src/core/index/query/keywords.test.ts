import { describe, expect, it } from 'vitest';
import { keywordsToSql, parseKeywords, type KeywordNode } from './keywords';

const t = (text: string): KeywordNode => ({ kind: 'term', text });
const q = (text: string): KeywordNode => ({ kind: 'term', text, exact: true });
const and = (...children: KeywordNode[]): KeywordNode => ({ kind: 'and', children });
const or = (...children: KeywordNode[]): KeywordNode => ({ kind: 'or', children });
const no = (child: KeywordNode): KeywordNode => ({ kind: 'not', child });

describe('parseKeywords', () => {
  it('space is AND and -word excludes', () => {
    expect(parseKeywords('cat -dog')).toEqual(and(t('cat'), no(t('dog'))));
  });

  it('OR (any case) and || between terms; quoted phrases stay whole', () => {
    expect(parseKeywords('"oil sketch" OR drawing')).toEqual(or(q('oil sketch'), t('drawing')));
    expect(parseKeywords('a || b')).toEqual(or(t('a'), t('b')));
    expect(parseKeywords('a or b')).toEqual(or(t('a'), t('b')));
  });

  it('parentheses group; AND binds tighter than OR', () => {
    expect(parseKeywords('(a || b) c')).toEqual(and(or(t('a'), t('b')), t('c')));
    expect(parseKeywords('a b OR c d')).toEqual(or(and(t('a'), t('b')), and(t('c'), t('d'))));
    expect(parseKeywords('-(a b)')).toEqual(no(and(t('a'), t('b'))));
    expect(parseKeywords('-"oil sketch" x')).toEqual(and(no(q('oil sketch')), t('x')));
  });

  it('malformed input degrades to a plain AND of the words', () => {
    expect(parseKeywords('"oil sketch')).toEqual(and(t('oil'), t('sketch')));
    expect(parseKeywords('(a b')).toEqual(and(t('a'), t('b')));
    expect(parseKeywords('a) b')).toEqual(and(t('a'), t('b')));
    expect(parseKeywords('cat OR')).toEqual(t('cat'));
    expect(parseKeywords('a OR OR b')).toEqual(and(t('a'), t('b')));
    expect(parseKeywords('()')).toBeNull();
    expect(parseKeywords('or')).toEqual(t('or')); // just the word, nothing to be an operator between
  });

  it('degraded queries keep their exclusions', () => {
    expect(parseKeywords('cat -dog "unclosed')).toEqual(and(t('cat'), no(t('dog')), t('unclosed')));
  });

  it('nothing to search for is null; a lone dash is ignored; hyphens inside words stay', () => {
    expect(parseKeywords('')).toBeNull();
    expect(parseKeywords('   ')).toBeNull();
    expect(parseKeywords('-')).toBeNull();
    expect(parseKeywords('a - b')).toEqual(and(t('a'), t('b')));
    expect(parseKeywords('well-known')).toEqual(t('well-known'));
    expect(parseKeywords('--x')).toEqual(no(t('-x')));
  });

  it('curly quotes count as quotes', () => {
    expect(parseKeywords('“oil sketch”')).toEqual(q('oil sketch'));
  });
});

describe('keywordsToSql', () => {
  it('binds every user string, never concatenates it', () => {
    const evil = `x'; DROP TABLE items; --`;
    const { sql, params } = keywordsToSql(parseKeywords(`"${evil}"`)!);
    expect(sql).not.toContain('DROP');
    expect(params).toContain(`"${evil}"`);
  });

  it('uses the trigram index from 3 characters and the marked item_search text below', () => {
    const long = keywordsToSql(t('Cat'));
    expect(long.sql).toContain('items_fts MATCH');
    expect(long.params).toEqual(['"Cat"', '\u0001cat']); // trigram candidates, then a word start
    const short = keywordsToSql(t('Ab'));
    expect(short.sql).not.toContain('items_fts');
    expect(short.sql).toContain('item_search');
    expect(short.params).toEqual(['\u0001ab']);
  });

  it('quoted phrases, the partial mode and unspaced scripts match anywhere', () => {
    expect(keywordsToSql(q('oil sk')).params).toEqual(['"oil sk"']);
    expect(keywordsToSql(t('Ab'), 'partial').params).toEqual(['ab']);
    expect(keywordsToSql(t('艺术')).params).toEqual(['艺术']);
  });

  it('escapes double quotes inside an FTS phrase', () => {
    expect(keywordsToSql(q('a"b')).params).toEqual(['"a""b"']);
  });
});
