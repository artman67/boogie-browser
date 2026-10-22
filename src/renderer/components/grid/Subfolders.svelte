<script lang="ts">
  // "Folders (9)" above the items of a folder that has child folders: every one of them, wrapping
  // onto as many rows as it takes, so a folder of folders reads like one.
  import type { FolderNode } from '../../../shared/types';
  import SubfolderCard from './SubfolderCard.svelte';

  let { folders, items }: { folders: FolderNode[]; items: boolean } = $props();
</script>

<section class="subfolders" aria-label="Subfolders">
  <div class="hd">Folders ({folders.length})</div>
  <div class="subs">
    {#each folders as f (f.id)}<SubfolderCard node={f} />{/each}
  </div>
  {#if items}<div class="divl"></div>{/if}
</section>

<style>
  .hd {
    padding: 14px 18px 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--mu);
  }
  .subs {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    padding: 0 18px 6px;
  }
  .divl {
    height: 1px;
    background: var(--line);
    margin: 12px 18px 0;
  }
</style>
