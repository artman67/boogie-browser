import { describe, expect, it } from 'vitest';
import { buildPalette, type PaletteInput, type Place } from './paletteModel';

const folder = (
  id: string,
  name: string,
  parents: string[],
  parentId: string | null,
  count: number,
): Place => ({
  kind: 'folder',
  id,
  name,
  parents,
  parentId,
  count,
});

const places: Place[] = [
  folder('F1', 'Teachers', [], null, 300),
  folder('F2', 'Robert Fleury', ['Teachers'], 'F1', 29),
  folder('F3', 'Hands', [], null, 80),
  folder('F4', 'Hands', ['Teachers', 'Robert Fleury'], 'F2', 5),
  folder('F5', 'Hand studies', ['Teachers'], 'F1', 12),
  { kind: 'smartFolder', id: 'S1', name: 'Fleshy', parents: [], parentId: null, count: 4 },
];

const base: PaletteInput = {
  text: '',
  selectionCount: 0,
  canEdit: true,
  currentKeywords: '',
  places,
  tags: [
    { name: 'Flesh Tones', count: 8 },
    { name: 'Color Poetry', count: 3 },
    { name: 'handsome', count: 2 },
  ],
  images: null,
  commands: [
    { id: 'edit.undo', title: 'Undo', keys: ['Ctrl+Z'], icon: 'undo-2' },
    { id: 'app.search', title: 'Search…', keys: ['Ctrl+F'] },
    { id: 'item.rename', title: 'Rename…', keys: ['F2', 'Ctrl+R'] },
    { id: 'view.zoomIn', title: 'Bigger thumbnails', keys: ['Ctrl+='] },
  ],
  recentCommandIds: [],
  libraries: [{ path: '/lib/Course Library.library', name: 'Course Library' }],
};

const palette = (input: Partial<PaletteInput>) => buildPalette({ ...base, ...input });
const titles = (input: Partial<PaletteInput>) => palette(input).map((s) => s.title);
const labels = (input: Partial<PaletteInput>, section: string) =>
  palette(input)
    .find((s) => s.title === section)
    ?.rows.map((r) => r.segs.map((g) => g.text).join('')) ?? [];

describe('buildPalette', () => {
  it('puts the folder you named on top, then images, folders, and tags last', () => {
    const s = palette({ text: 'fleury', images: { total: 12, thumbs: [] } });
    expect(s.map((x) => x.title)).toEqual(['Top hit', 'Images']);
    expect(s[0].rows[0]).toMatchObject({
      big: true,
      where: 'in Teachers',
      path: 'Teachers › Robert Fleury',
    });
    expect(labels({ text: 'fle' }, 'Images')).toEqual(['Search for “fle”']);
    expect(titles({ text: 'fle' })).toEqual(['Top hit', 'Images', 'Folders', 'Tags']);
    expect(labels({ text: 'fle', images: { total: 3, thumbs: [] } }, 'Images')).toEqual([
      'Show all 3 items matching “fle”',
    ]);
  });

  it('matches words, never letters scattered across a name', () => {
    expect(titles({ text: 'tfy' })).not.toContain('Folders');
    expect(labels({ text: 'tfy' }, 'Folders and tags')).toEqual([
      'No folder or tag is named “tfy”.',
    ]);
  });

  it('says where a folder is in short, and puts a whole word before the start of one', () => {
    const rows = palette({ text: 'hand' })
      .flatMap((x) => x.rows)
      .filter((r) => r.action.kind === 'goFolder');
    expect(rows.map((r) => [r.key, r.where])).toEqual([
      ['go:F5', 'in Teachers'],
      ['go:F3', undefined],
      ['go:F4', 'in … › Robert Fleury'],
    ]);
  });

  it('lists the folders inside a matching folder when it is opened', () => {
    const tree: Place[] = [
      folder('A', 'Hands', [], null, 50),
      folder('B', 'Hands old', ['Hands'], 'A', 10),
      folder('C', 'Hands new', ['Hands'], 'A', 9),
    ];
    const closed = palette({ text: 'hands', places: tree }).flatMap((x) => x.rows);
    expect(closed.find((r) => r.key === 'go:A')).toMatchObject({ inside: 2, open: false });
    expect(closed.some((r) => r.key === 'in:B')).toBe(false);
    const open = palette({ text: 'hands', places: tree, expanded: 'A' }).flatMap((x) => x.rows);
    expect(open.filter((r) => r.nested).map((r) => r.key)).toEqual(['in:B', 'in:C']);
  });

  it('falls back to close spellings only when nothing matches as typed', () => {
    expect(labels({ text: 'fleurry' }, 'Close spelling')).toEqual(['Robert Fleury']);
    // "hands" matches folders, so the tag one letter off ("handsome" is not) stays out.
    expect(titles({ text: 'hands' })).not.toContain('Close spelling');
  });

  it('offers Ctrl+Enter to add the selection, but not to smart folders or read-only libraries', () => {
    const rows = palette({ text: 'fle', selectionCount: 2 }).flatMap((x) => x.rows);
    expect(rows.find((r) => r.key === 'go:F2')?.alt?.action).toEqual({
      kind: 'addToFolder',
      id: 'F2',
      name: 'Robert Fleury',
    });
    expect(rows.find((r) => r.key === 'go:S1')?.alt).toBeUndefined();
    expect(rows.find((r) => r.key === 'tag:Flesh Tones')?.alt?.action).toEqual({
      kind: 'addTag',
      tag: 'Flesh Tones',
    });
    expect(labels({ text: 'fle', selectionCount: 2 }, 'Tags')).toContain(
      'Create tag “fle” and add to 2 selected',
    );
    expect(labels({ text: 'flesh tones', selectionCount: 2 }, 'Tags')).not.toContain(
      'Create tag “flesh tones” and add to 2 selected',
    );
    const ro = palette({ text: 'fle', selectionCount: 2, canEdit: false }).flatMap((x) => x.rows);
    expect(ro.some((r) => r.alt || r.key === 'createTag')).toBe(false);
  });

  it('puts commands first when you type the start of one, so Enter runs it', () => {
    expect(titles({ text: 'rename' })[0]).toBe('Commands');
    expect(titles({ text: 'bigger thumb' })[0]).toBe('Commands');
    // A short or partial match is still a search first.
    expect(titles({ text: 'ren' })[0]).toBe('Images');
    expect(titles({ text: 'thumbnails' })[0]).toBe('Images');
    expect(labels({ text: 'ren' }, 'Commands')).toEqual(['Rename…']);
    expect(labels({ text: 'cour' }, 'Libraries')).toEqual(['Switch to Course Library']);
  });

  it('shows recent then suggested commands when empty, and a way to clear the current search', () => {
    const s = palette({ recentCommandIds: ['edit.undo', 'gone.command'], currentKeywords: 'oil' });
    expect(s.map((x) => x.title)).toEqual(['Search', 'Recent', 'Commands']);
    expect(s[1].rows.map((r) => r.action)).toEqual([{ kind: 'command', id: 'edit.undo' }]);
    expect(s[1].rows[0].keys).toBe('Ctrl Z');
    expect(s[2].rows.map((r) => r.action)).not.toContainEqual({ kind: 'command', id: 'edit.undo' });
  });

  it('offers the last searches (not the one already on) to run again', () => {
    const input = { currentKeywords: 'oil', recentSearches: ['oil', 'hands', 'sketch'] };
    expect(labels(input, 'Recent searches')).toEqual(['hands', 'sketch']);
    expect(palette(input).find((x) => x.title === 'Recent searches')?.rows[0].action).toEqual({
      kind: 'search',
      text: 'hands',
    });
  });
});
