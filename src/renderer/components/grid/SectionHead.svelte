<script lang="ts" module>
  /** Heading height, plus DIVIDER_H on the first section from elsewhere. */
  export const HEAD_H = 34;
  export const DIVIDER_H = 32;
</script>

<script lang="ts">
  // A heading over one run of a search that also looked outside the current scope: the scope's own
  // matches, then (under an "Elsewhere" divider) each folder that has more. A folder's heading
  // opens that folder with the same search.
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Folder from '@lucide/svelte/icons/folder';
  import { library } from '../../lib/stores/library.svelte';
  import { view } from '../../lib/stores/view.svelte';
  import { FOLDER_COLORS, type ResultSection } from '../../../shared/types';
  import { whereYouAre } from '../toolbar/where';

  let {
    section,
    count,
    divider,
    y,
  }: {
    section: ResultSection;
    count: number;
    /** How many matches are outside the scope; set on the first one only (draws the divider). */
    divider: number | null;
    y: number;
  } = $props();

  const where = $derived(whereYouAre());
  const folder = $derived(section.folderId ? library.folder(section.folderId)?.node : undefined);
  const ancestors = $derived.by(() => {
    const out: string[] = [];
    let p = section.folderId ? library.folder(section.folderId)?.parentId : undefined;
    while (p) {
      const f = library.folder(p);
      if (!f) break;
      out.unshift(f.node.name);
      p = f.parentId;
    }
    return out;
  });

  function open() {
    if (!section.folderId) return;
    view.setScope(
      { kind: 'folder', id: section.folderId, includeSubfolders: view.showSubfolderContents },
      { keepFilter: true },
    );
  }
</script>

<div class="head" style="top: {y}px">
  {#if divider !== null}
    <div class="div">
      <span>Elsewhere in the library</span><span class="n">{divider.toLocaleString()}</span>
    </div>
  {/if}
  <div class="row">
    {#if section.kind === 'here'}
      <span class="nm">{count ? `In ${where.name}` : `Nothing in ${where.name}`}</span>
      {#if count}<span class="n">{count.toLocaleString()}</span>{/if}
    {:else if section.kind === 'none'}
      <span class="nm">Not in a folder</span><span class="n">{count.toLocaleString()}</span>
    {:else}
      <button class="go" onclick={open} title="Open this folder with the same search">
        <Folder
          size={14}
          color={folder?.iconColor ? FOLDER_COLORS[folder.iconColor] : 'currentColor'}
        />
        {#each ancestors as a (a)}<span class="up">{a}</span><span class="sep">›</span>{/each}
        <span class="nm">{folder?.name ?? 'Folder'}</span>
        <span class="n">{count.toLocaleString()}</span>
        <ChevronRight size={14} class="chev" />
      </button>
    {/if}
  </div>
</div>

<style>
  .head {
    position: absolute;
    left: 0;
    right: 0;
    padding: 0 18px;
    font-size: 12px;
    color: var(--mu);
  }
  .div {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px; /* DIVIDER_H */
    font-weight: 600;
    color: var(--tx);
  }
  .div::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 34px; /* HEAD_H */
    min-width: 0;
  }
  .nm {
    font-weight: 600;
    color: var(--tx);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .n {
    color: var(--fa);
  }
  .go {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
    color: inherit;
  }
  .up {
    white-space: nowrap;
  }
  .sep {
    color: var(--fa);
  }
  .go :global(.chev) {
    flex: none;
    opacity: 0;
    transition: opacity 120ms ease-out;
  }
  .go:hover .nm {
    text-decoration: underline;
  }
  .go:hover :global(.chev) {
    opacity: 1;
  }
</style>
