<script lang="ts">
  // Folders of one item, or the union over a multi-selection. A folder every selected item is in
  // shows its whole path: its name jumps there with the selection kept, a parent's name opens that
  // parent. A folder only some are in is a dim chip that adds the rest.
  import Folder from '@lucide/svelte/icons/folder';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import type { Item } from '../../../shared/types';
  import { library } from '../../lib/stores/library.svelte';
  import { view } from '../../lib/stores/view.svelte';
  import { ui } from '../../lib/stores/ui.svelte';
  import { plural, quoted } from '../../lib/format';
  import { showInFolder } from '../../lib/reveal';
  import Chip from './Chip.svelte';
  import { editSelected } from './edit';
  import { folderColor, unionCounts } from './logic';

  let { items, ids, readonly }: { items: Item[]; ids: string[]; readonly: boolean } = $props();

  const n = $derived(items.length);
  // An id that is not in the tree (Eagle leaves these behind) has nothing to show or open.
  const counted = $derived(
    unionCounts(items.map((i) => i.folders)).filter((c) => library.folder(c.key)),
  );

  function open(id: string) {
    view.setScope({ kind: 'folder', id, includeSubfolders: view.showSubfolderContents });
  }

  function ancestors(id: string): { id: string; name: string }[] {
    const out: { id: string; name: string }[] = [];
    for (let p = library.folder(id)?.parentId; p; p = library.folder(p)?.parentId) {
      const info = library.folder(p);
      if (!info) break;
      out.unshift({ id: p, name: info.node.name });
    }
    return out;
  }

  function addTo(id: string, name: string) {
    return editSelected(
      ids,
      { addFolders: [id] },
      { what: `add ${plural(ids.length, 'item')} to ${quoted(name)}` },
    );
  }

  function removeFrom(id: string, name: string) {
    const done =
      ids.length > 1
        ? `Removed ${plural(ids.length, 'item')} from ${quoted(name)}`
        : `Removed from ${quoted(name)}`;
    return editSelected(
      ids,
      { removeFolders: [id] },
      { what: `remove ${plural(ids.length, 'item')} from ${quoted(name)}`, done },
    );
  }
</script>

<div class="lbl">Folders</div>
<div class="chips">
  {#each counted as f (f.key)}
    {@const info = library.folder(f.key)!}
    {@const name = info.node.name}
    {#if f.count < n}
      <Chip
        label={name}
        dim
        sub={`${f.count} of ${n}`}
        title={`${info.path.join(' › ')}\nIn ${f.count} of ${n} items. Click to add it to all.`}
        onclick={readonly ? undefined : () => addTo(f.key, name)}
        onremove={readonly ? undefined : () => removeFrom(f.key, name)}
      >
        {#snippet lead()}<span class="fd" style:color={folderColor(info.node.iconColor)}
            ><Folder size={13} fill="currentColor" strokeWidth={1.5} /></span
          >{/snippet}
      </Chip>
    {:else}
      <span class="path" class:rm={!readonly}>
        <span class="fd" style:color={folderColor(info.node.iconColor)}
          ><Folder size={13} fill="currentColor" strokeWidth={1.5} /></span
        >
        {#each ancestors(f.key) as a (a.id)}
          <button type="button" class="up" title="Open {a.name}" onclick={() => open(a.id)}
            >{a.name}</button
          ><span class="sep" aria-hidden="true">›</span>
        {/each}
        <button
          type="button"
          class="leaf"
          title={n > 1 ? `Show these items in ${name}` : `Show it in ${name}`}
          onclick={() => void showInFolder(ids, f.key)}>{name}</button
        >
        {#if !readonly}
          <button
            type="button"
            class="x"
            aria-label="Remove from {name}"
            title="Remove"
            onclick={() => removeFrom(f.key, name)}><X size={11} /></button
          >
        {/if}
      </span>
    {/if}
  {/each}
  {#if !readonly}
    <Chip label="Add" ghost title="Add to a folder" onclick={() => ui.openOverlay('folderPicker')}>
      {#snippet lead()}<Plus size={13} />{/snippet}
    </Chip>
  {/if}
</div>
{#if !counted.length && readonly}<div class="note">Not in a folder</div>{/if}
{#if ids.length > n}<div class="note trunc">
    Folders shown are from the first {n.toLocaleString()} of {ids.length.toLocaleString()} items.
  </div>{/if}

<style>
  .trunc {
    margin-top: 6px;
  }
  .fd {
    display: inline-grid;
    color: var(--mu);
    flex: none;
  }
  /* Same look as a Chip, but the path wraps instead of being cut off. */
  .path {
    position: relative;
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 3px;
    max-width: 100%;
    min-height: 24px;
    padding: 3px 9px;
    border-radius: 5px;
    background: var(--chip);
    font-size: 12px;
    line-height: 18px;
  }
  .path .fd {
    margin-right: 2px;
  }
  .path.rm {
    padding-right: 17px;
  }
  .up,
  .leaf {
    cursor: pointer;
    overflow-wrap: anywhere;
    text-align: left;
  }
  .up {
    color: var(--mu);
  }
  .leaf {
    color: var(--tx);
    font-weight: 600;
  }
  .up:hover,
  .leaf:hover {
    text-decoration: underline;
  }
  .sep {
    color: var(--fa);
  }
  .x {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    display: grid;
    place-items: center;
    width: 17px;
    color: var(--mu);
    border-radius: 0 5px 5px 0;
    opacity: 0;
    cursor: pointer;
  }
  .path:hover .x,
  .x:focus-visible {
    opacity: 1;
  }
  .x:hover {
    color: var(--tx);
  }
</style>
