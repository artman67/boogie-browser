<script lang="ts">
  // The subfolders as rows above the items in the list layout (Details), like a file manager.
  // One click opens a folder, as the cards do in the thumbnail layouts.
  import type { FolderNode } from '../../../shared/types';
  import { plural } from '../../lib/format';
  import { library } from '../../lib/stores/library.svelte';
  import { view } from '../../lib/stores/view.svelte';
  import FolderGlyph from '../sidebar/FolderGlyph.svelte';

  let { folders }: { folders: FolderNode[] } = $props();

  // Sorting the list by name sorts the folders too; other columns don't apply, so they keep
  // the folder's own order. Folders always stay above the items.
  const sorted = $derived.by(() => {
    const sort = view.sort ?? view.result?.sort;
    if (sort?.by !== 'NAME') return folders;
    const dir = sort.ascending ? 1 : -1;
    return [...folders].sort(
      (a, b) => dir * a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
  });

  function open(id: string) {
    view.setScope({ kind: 'folder', id, includeSubfolders: view.showSubfolderContents });
  }
</script>

<div class="rows" role="group" aria-label="Subfolders">
  {#each sorted as f (f.id)}
    {@const count = library.counts?.folders[f.id]?.deep}
    <button class="row" title={f.name} onclick={() => open(f.id)}>
      <span class="ic"><FolderGlyph color={f.iconColor} icon={f.icon} /></span>
      <span class="name">{f.name}</span>
      <span class="ext">Folder</span>
      <span class="c-dim"></span>
      <span class="num">{count === undefined ? '' : plural(count, 'item')}</span>
    </button>
  {/each}
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: var(--list-cols);
    align-items: center;
    column-gap: 10px;
    width: 100%;
    height: 36px;
    padding: 0 12px 0 8px;
    border-bottom: 1px solid var(--line);
    font-size: 12.5px;
    text-align: left;
  }
  .row:hover {
    background: var(--hov);
  }
  .row:focus-visible {
    outline: 2px solid var(--bl);
    outline-offset: -2px;
  }
  .ic {
    display: grid;
    place-items: center;
    width: 36px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ext {
    color: var(--mu);
    font-size: 11px;
  }
  .num {
    color: var(--mu);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
