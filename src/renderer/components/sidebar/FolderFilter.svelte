<script lang="ts">
  // The "Filter folders" box and its flat list of matching folders, shown instead of the tree
  // while there is a query. The tree reads `query` to know it is hidden and to keep its own keys off.
  import { library } from '../../lib/stores/library.svelte';
  import { view } from '../../lib/stores/view.svelte';
  import FolderGlyph from './FolderGlyph.svelte';
  import * as act from './actions';
  import { filterFolders, shorten } from './tree';

  let {
    query = $bindable(''),
    oncleared,
  }: {
    query?: string;
    /** Escape emptied the box: the tree is back. */
    oncleared: () => void;
  } = $props();

  let hi = $state(0);
  let resultsEl = $state<HTMLElement | null>(null);
  const filtering = $derived(!!query.trim());
  const found = $derived(
    filterFolders(library.folders, query, 50, (id) => library.counts?.folders[id]?.deep ?? 0),
  );
  const scopeId = $derived(view.scope.kind === 'folder' ? view.scope.id : null);

  function filterKey(e: KeyboardEvent) {
    const hits = found.hits;
    if (e.key === 'ArrowDown') hi = Math.min(hi + 1, hits.length - 1);
    else if (e.key === 'ArrowUp') hi = Math.max(hi - 1, 0);
    else if (e.key === 'Enter') {
      if (hits[hi]) act.openFolder(hits[hi].id);
    } else if (e.key === 'Escape') {
      if (!query) return;
      query = '';
      hi = 0;
      oncleared();
    } else return;
    e.preventDefault();
    queueMicrotask(() => resultsEl?.querySelector('.hi')?.scrollIntoView({ block: 'nearest' }));
  }
</script>

{#if library.folders.size > 30}
  <input
    class="sb-filter"
    placeholder="Filter folders"
    aria-label="Filter folders"
    role="combobox"
    aria-expanded={filtering}
    aria-autocomplete="list"
    aria-controls="ff-list"
    aria-activedescendant={filtering && found.hits[hi] ? `ff-${found.hits[hi].id}` : undefined}
    autocomplete="off"
    spellcheck="false"
    bind:value={query}
    oninput={() => (hi = 0)}
    onkeydown={filterKey}
  />
{/if}
{#if filtering}
  <div
    class="results"
    id="ff-list"
    role="listbox"
    aria-label="Matching folders"
    bind:this={resultsEl}
  >
    {#each found.hits as h, i (h.id)}
      {@const f = library.folder(h.id)?.node}
      {@const n = library.counts?.folders[h.id]?.deep}
      <!-- The filter box keeps the keyboard (aria-activedescendant); a click opens the folder. -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="res"
        class:hi={i === hi}
        class:sel={scopeId === h.id}
        id="ff-{h.id}"
        role="option"
        tabindex="-1"
        aria-selected={i === hi}
        title={[...h.parents, h.name].join(' › ')}
        onmousemove={() => (hi = i)}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => act.openFolder(h.id)}
      >
        <div class="a">
          <FolderGlyph color={f?.iconColor} icon={f?.icon} />
          <span class="fn"
            >{#each h.segs as s, j (j)}{#if s.hit}<mark>{s.text}</mark
                >{:else}{s.text}{/if}{/each}</span
          >
          {#if n}<span class="sb-ct">{n.toLocaleString()}</span>{/if}
        </div>
        {#if h.parents.length}<div class="p">
            {h.parents.map((p) => shorten(p)).join(' › ')}
          </div>{/if}
      </div>
    {/each}
    {#if !found.total}
      <div class="sb-hint">No folders match.</div>
    {:else if found.total > found.hits.length}
      <div class="sb-hint">{(found.total - found.hits.length).toLocaleString()} more</div>
    {/if}
  </div>
{/if}

<style>
  .results {
    padding-bottom: 4px;
  }
  .res {
    margin: 0 8px;
    padding: 5px 10px;
    border-radius: var(--radius);
    cursor: default;
    user-select: none;
  }
  .res.hi {
    background: var(--hov);
  }
  .res .a {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .res .fn {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
  }
  .res.sel .fn {
    color: var(--link);
    font-weight: 600;
  }
  .res .p {
    margin: 1px 0 0 23px;
    font-size: 11px;
    color: var(--fa);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  mark {
    background: color-mix(in srgb, var(--bl) 35%, transparent);
    color: white;
    border-radius: 2px;
  }
</style>
