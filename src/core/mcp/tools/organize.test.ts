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

  it('says to take items out first when subfolders alone cannot bring it under the limit', async () => {
    const idx = new FolderIndex([node('Top', [node('Sub')])]);
    const api = {
      getCounts: async () => ({ folders: { Sub: { deep: 10 } } }),
    } as unknown as CoreApi;
    const msg = (await tooBigToDelete(api, idx, 'Top', 2010, true)).message;
    expect(msg).toMatch(
      /Delete these subfolders first \(each with delete_contents true, as here\)/,
    );
    expect(msg).toMatch(
      /still leaves over 500: then move its items that are in no other folder to the trash/,
    );
  });
});
