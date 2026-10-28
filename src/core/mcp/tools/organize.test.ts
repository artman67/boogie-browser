import { describe, expect, it } from 'vitest';
import type { CoreApi } from '../../../shared/api';
import type { FolderNode } from '../../../shared/types';
import { FolderIndex } from '../folders';
import { tooBigToDelete } from './organize';

const node = (id: string, children: FolderNode[] = []): FolderNode =>
  ({ id, name: id, description: '', children, tags: [] }) as unknown as FolderNode;

describe('a folder tree over the apply limit', () => {
  it('names the topmost subfolders that fit, biggest first', async () => {
    const idx = new FolderIndex([
      node('Top', [
        node('Big', [node('BigA'), node('BigB')]),
        node('Mid', [node('MidA')]),
        node('Empty'),
      ]),
    ]);
    const deep: Record<string, number> = {
      Big: 700,
      BigA: 400,
      BigB: 300,
      Mid: 350,
      MidA: 50,
      Empty: 0,
    };
    const api = {
      getCounts: async () => ({
        folders: Object.fromEntries(Object.entries(deep).map(([id, n]) => [id, { deep: n }])),
      }),
    } as unknown as CoreApi;
    const msg = (await tooBigToDelete(api, idx, 'Top', 1050)).message;
    // Big is too big, so its children are named; MidA is covered by Mid; Empty has nothing to move.
    expect(msg).toMatch(
      /Top \/ Big \/ BigA \(BigA, 400 items\); Top \/ Mid \(Mid, 350 items\); Top \/ Big \/ BigB \(BigB, 300 items\)\.$/,
    );
  });
});
