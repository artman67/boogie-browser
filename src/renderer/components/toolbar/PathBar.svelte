<script lang="ts">
  // The path bar under the toolbar: library › each parent folder › where you are. Every crumb goes
  // there (Back returns), each › lists the folders one level down, and the last crumb opens the
  // view options. A long path folds its middle into "…" (pathFit decides; this measures). The item
  // count and "Empty trash" sit at the right end.
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { emptyTrash } from '../../lib/appCommands';
  import { contextMenu, openMenuBelow, type MenuItem } from '../../lib/contextMenu.svelte';
  import { readOnlyTip } from '../../lib/edit';
  import { goToFolder } from '../../lib/folders';
  import { initials } from '../../lib/format';
  import { library } from '../../lib/stores/library.svelte';
  import { view } from '../../lib/stores/view.svelte';
  import type { FolderNode } from '../../../shared/types';
  import { FOLDER_COLORS } from '../../../shared/types';
  import { fitPath, type PathWidths } from './pathFit';
  import { viewMenu } from './menus';
  import { whereYouAre } from './where';

  const where = $derived(whereYouAre());
  const libName = $derived(library.state?.ref.name ?? '');
  const here = $derived(view.scope.kind === 'folder' ? library.folder(view.scope.id) : undefined);
  /** The folders above the current one, top level first. */
  const ancestors = $derived.by(() => {
    const out: FolderNode[] = [];
    for (let id = here?.parentId; id;) {
      const f = library.folder(id);
      if (!f) break;
      out.unshift(f.node);
      id = f.parentId;
    }
    return out;
  });
  const count = $derived(view.result ? view.result.total.toLocaleString() : '');

  // ── fitting ──
  let avail = $state(0);
  let measureEl = $state<HTMLDivElement | null>(null);
  let widths = $state<PathWidths | null>(null);
  let fontsReady = $state(0);
  document.fonts?.ready.then(() => fontsReady++);

  // Re-measure whenever what the crumbs say changes (the measuring row renders all of them).
  $effect(() => {
    void [libName, ancestors, where, here, fontsReady];
    const m = measureEl;
    if (!m) return;
    const w = (sel: string) =>
      [...m.querySelectorAll(sel)].map((e) => e.getBoundingClientRect().width);
    widths = {
      library: w('[data-m=lib]')[0] ?? 0,
      libraryBadge: w('[data-m=badge]')[0] ?? 0,
      ancestors: w('[data-m=anc]'),
      current: w('[data-m=cur]')[0] ?? 0,
      fold: w('[data-m=fold]')[0] ?? 0,
    };
  });
  // 1 px of slack for rounding.
  const fit = $derived(
    widths && avail ? fitPath(widths, avail - 1) : { folded: 0, libraryName: true },
  );
  const folded = $derived(ancestors.slice(0, fit.folded));
  const shown = $derived(ancestors.slice(fit.folded));

  // ── menus ──
  /** Which › (or "…") has its menu open, to keep it highlighted. */
  let opened = $state<string | null>(null);
  $effect(() => {
    if (!contextMenu.open) opened = null;
  });

  function open(key: string, el: EventTarget | null, items: MenuItem[]) {
    openMenuBelow(el as Element, items);
    opened = key;
  }

  /** The folders in `parent` (null: top level), the one on the current path marked. */
  function foldersIn(parent: FolderNode | null): MenuItem[] {
    const kids = parent ? parent.children : (library.state?.folders ?? []);
    const onPath = new Set([...ancestors.map((f) => f.id), here?.node.id]);
    return kids.map((f) => ({
      label: f.name,
      keys: library.counts?.folders[f.id]?.deep.toLocaleString(),
      swatch: f.iconColor ? FOLDER_COLORS[f.iconColor] : undefined,
      checked: onPath.has(f.id),
      run: () => goToFolder(f.id),
    }));
  }

  const foldMenu = (): MenuItem[] =>
    folded.map((f, i) => ({ label: f.name, indent: i, run: () => goToFolder(f.id) }));
</script>

{#snippet sep(key: string, parent: FolderNode | null)}
  {@const label = parent ? `Folders in ${parent.name}` : 'Folders'}
  <button
    class="sep"
    class:open={opened === key}
    title={label}
    aria-label={label}
    aria-haspopup="menu"
    onclick={(e) => open(key, e.currentTarget, foldersIn(parent))}
    ><ChevronRight size={14} /></button
  >
{/snippet}

{#snippet lib(name: boolean)}
  <button
    class="cr"
    title={name ? 'All' : libName}
    aria-label={libName}
    onclick={() => goToFolder(null)}
  >
    <span class="av">{initials(libName)}</span>
    {#if name}<span class="nm">{libName}</span>{/if}
  </button>{@render sep('lib', null)}
{/snippet}

{#snippet folder(f: FolderNode)}
  <button class="cr" onclick={() => goToFolder(f.id)}>{f.name}</button>{@render sep(f.id, f)}
{/snippet}

{#snippet fold()}
  <button
    class="cr"
    class:open={opened === 'fold'}
    title="More folders"
    aria-label="More folders"
    aria-haspopup="menu"
    onclick={(e) => open('fold', e.currentTarget, foldMenu())}>…</button
  >{@render sep('foldsep', folded.at(-1) ?? null)}
{/snippet}

{#snippet current()}
  <button
    class="cr last"
    title="View options"
    aria-haspopup="menu"
    aria-current="location"
    onclick={(e) => openMenuBelow(e.currentTarget, viewMenu())}
  >
    {#if where.color}
      <where.icon size={15} style="color:{where.color};fill:{where.color}" />
    {:else}
      <where.icon size={15} class="muted" />
    {/if}
    <span class="nm">{where.name}</span>
    <ChevronDown size={13} class="muted" />
  </button>{#if here?.node.children.length}{@render sep('here', here.node)}{/if}
{/snippet}

{#if library.state}
  <nav class="pb" aria-label="Path">
    <div class="trail" bind:clientWidth={avail}>
      <span class="pc">{@render lib(fit.libraryName)}</span>
      {#if folded.length}<span class="pc">{@render fold()}</span>{/if}
      {#each shown as f (f.id)}<span class="pc">{@render folder(f)}</span>{/each}
      <span class="pc cur">{@render current()}</span>
    </div>
    {#if count}<span class="n" aria-label="Items shown">{count}</span>{/if}
    {#if view.scope.kind === 'trash' && library.counts?.trash}
      <button
        class="emptytrash"
        disabled={library.readOnly}
        title={readOnlyTip() ?? 'Remove everything in the trash from the library'}
        onclick={() => emptyTrash()}>Empty trash</button
      >
    {/if}
    <!-- Every piece at full width, unseen, for pathFit. -->
    <div class="measure" aria-hidden="true" inert bind:this={measureEl}>
      <span class="pc" data-m="lib">{@render lib(true)}</span>
      <span class="pc" data-m="badge">{@render lib(false)}</span>
      <span class="pc" data-m="fold">{@render fold()}</span>
      {#each ancestors as f (f.id)}<span class="pc" data-m="anc">{@render folder(f)}</span>{/each}
      <span class="pc" data-m="cur">{@render current()}</span>
    </div>
  </nav>
{/if}

<style>
  .pb {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    flex: none;
    padding: 0 10px 0 8px;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
    overflow: hidden;
    user-select: none;
    white-space: nowrap;
  }
  .trail {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
  }
  .pc {
    display: flex;
    align-items: center;
    flex: none;
  }
  /* The current folder is the one piece that gives way, and only once everything else has. */
  .trail .cur {
    flex: 0 1 auto;
    min-width: 0;
  }
  .measure {
    position: absolute;
    left: 0;
    top: 0;
    display: flex;
    visibility: hidden;
    pointer-events: none;
  }
  .cr {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 24px;
    padding: 0 6px;
    border-radius: 6px;
    color: var(--mu);
    font-size: 12.5px;
  }
  .cr.last {
    color: var(--tx);
    font-weight: 600;
    font-size: 13px;
  }
  .cr .nm {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cr :global(svg) {
    flex: none;
  }
  .cr :global(.muted) {
    color: var(--fa);
  }
  .av {
    width: 17px;
    height: 17px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 4px;
    font-size: 8px;
    font-weight: 700;
    background: linear-gradient(135deg, var(--chip), var(--hov));
    border: 1px solid var(--chip-line);
    color: var(--tx);
  }
  .sep {
    display: grid;
    place-items: center;
    flex: none;
    width: 18px;
    height: 24px;
    border-radius: 5px;
    color: var(--fa);
  }
  .cr:hover,
  .sep:hover,
  .open {
    background: var(--hov);
    color: var(--tx);
  }
  .cr:focus-visible,
  .sep:focus-visible,
  .emptytrash:focus-visible {
    outline: 2px solid var(--bl);
    outline-offset: -1px;
  }
  .n {
    flex: none;
    color: var(--fa);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .emptytrash {
    flex: none;
    height: 22px;
    padding: 0 10px;
    border-radius: 6px;
    border: 1px solid var(--line);
    color: var(--err);
    font-size: 12px;
  }
  .emptytrash:hover:not(:disabled) {
    background: var(--bls);
  }
  .emptytrash:disabled {
    color: var(--fa);
  }
</style>
