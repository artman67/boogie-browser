import { describe, expect, it } from 'vitest';
import { markWords, match, rank, WORD_MARK, words } from './match';

const names = (query: string, list: string[]) =>
  rank(query, list, (label) => ({ label })).map((r) => r.item);

describe('match', () => {
  it('splits words at punctuation, humps and digits, folding case and accents', () => {
    expect(words('DraperyDrawing_08Sargent Gérôme').map((w) => w.text)).toEqual([
      'drapery',
      'drawing',
      '08',
      'sargent',
      'gerome',
    ]);
  });

  it('never matches letters scattered across a name', () => {
    expect(names('horse', ['Horse studies', 'Hors d’oeuvre sketches', 'House of Orsay'])).toEqual([
      'Horse studies',
    ]);
    expect(names('mki', ['Mockup iPhone', 'Mi Kitchen'])).toEqual([]);
  });

  it('ranks a whole word over a word start over initials over the inside of a word', () => {
    expect(
      names('sarg', ['Sargent', 'John Singer Sargent', 'Sarg', 'notes-sargsketch']).slice(0, 2),
    ).toEqual(['Sarg', 'Sargent']);
    expect(names('jss', ['John Singer Sargent', 'Jss notes'])).toEqual([
      'Jss notes',
      'John Singer Sargent',
    ]);
    expect(names('sargent', ['sargentnotes', 'Sargent drawings'])).toEqual([
      'Sargent drawings',
      'sargentnotes',
    ]);
    // A word start may run into the next word ("iph" for "iPhone").
    expect(match('iph', 'Mockup iPhone')?.positions).toEqual([7, 8, 9]);
  });

  it('lets typed words match the folders above, but one must match the name itself', () => {
    const parents = ['Master Artists', 'John Singer Sargent'];
    expect(match('sargent drawing', 'Drawing', { parents })).not.toBeNull();
    expect(match('sargent', 'Drawing', { parents })).toBeNull();
  });

  it('allows one typo only when nothing matches without one', () => {
    expect(names('bougereau', ['Bouguereau', 'Boucher'])).toEqual(['Bouguereau']);
    expect(rank('bougereau', ['Bouguereau'], (label) => ({ label }))[0].hit.close).toBe(true);
    expect(names('hands', ['Hands', 'Hans Holbein'])).toEqual(['Hands']);
  });

  it('marks word starts for the keyword search', () => {
    expect(markWords('An ArmChair')).toBe(`${WORD_MARK}an ${WORD_MARK}arm${WORD_MARK}chair`);
  });
});
