import { describe, expect, it } from 'vitest';
import { whereLabels } from './folders';

describe('whereLabels', () => {
  it('shows the parent, and the first differing folder for two of the same name', () => {
    expect(
      whereLabels([
        { name: 'Hands', parents: ['Teachers', 'Fleury', 'Studies'] },
        { name: 'Hands', parents: ['Students', 'Fleury', 'Studies'] },
        { name: 'Feet', parents: ['Anatomy'] },
      ]),
    ).toEqual(['in Teachers › … › Studies', 'in Students › … › Studies', 'in Anatomy']);
  });
});
