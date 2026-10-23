<script lang="ts">
  // The 48 px bar above the grid: panel toggles, back/forward, layout, thumbnail zoom, sort, color
  // search, filters, the command bar, "+" and Settings (where you are is in PathBar, under it). Its
  // empty middle is the window's drag region. Also registers the app-wide shortcuts (see globalCommands.ts).
  import ArrowDownWideNarrow from '@lucide/svelte/icons/arrow-down-wide-narrow';
  import ArrowUpNarrowWide from '@lucide/svelte/icons/arrow-up-narrow-wide';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Funnel from '@lucide/svelte/icons/funnel';
  import ImageIcon from '@lucide/svelte/icons/image';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import List from '@lucide/svelte/icons/list';
  import PanelLeft from '@lucide/svelte/icons/panel-left';
  import PanelRight from '@lucide/svelte/icons/panel-right';
  import Pipette from '@lucide/svelte/icons/pipette';
  import Plus from '@lucide/svelte/icons/plus';
  import Search from '@lucide/svelte/icons/search';
  import Settings from '@lucide/svelte/icons/settings';
  import { openMenuBelow } from '../../lib/contextMenu.svelte';
  import { readOnlyTip } from '../../lib/edit';
  import {
    iconsLayout,
    setLayout,
    setThumbSize,
    shownLayout,
    ZOOM_MAX,
    ZOOM_MIN,
  } from '../../lib/prefs';
  import { sortLabel } from '../../lib/sorts';
  import { library } from '../../lib/stores/library.svelte';
  import { ui } from '../../lib/stores/ui.svelte';
  import { view } from '../../lib/stores/view.svelte';
  import { filterUi } from '../filters/filterUi.svelte';
  import { addMenu, currentSort, sortMenu } from './menus';

  const sort = $derived(currentSort());
  const SortIcon = $derived(sort.ascending ? ArrowUpNarrowWide : ArrowDownWideNarrow);
  // Before a library is open there is nothing to sort, filter, zoom or add to.
  const noLib = $derived(!library.state);
  const details = $derived(shownLayout() === 'list');
  const remembered = $derived(view.scope.kind === 'folder' ? ', kept for this folder' : '');
</script>

<div class="tb" role="toolbar" aria-label="Toolbar">
  <button
    class="ib"
    class:on={ui.sidebarVisible}
    title="Show or hide the sidebar (Ctrl+Alt+1)"
    aria-label="Show or hide the sidebar"
    aria-pressed={ui.sidebarVisible}
    onclick={() => (ui.sidebarVisible = !ui.sidebarVisible)}><PanelLeft size={16} /></button
  >
  <button
    class="ib"
    title="Back (Alt+Left)"
    aria-label="Back"
    disabled={!view.back.length}
    onclick={() => view.goBack()}><ChevronLeft size={16} /></button
  >
  <button
    class="ib fwd"
    title="Forward (Alt+Right)"
    aria-label="Forward"
    disabled={!view.forward.length}
    onclick={() => view.goForward()}><ChevronRight size={16} /></button
  >

  <div class="sp"></div>

  <div class="seg" role="group" aria-label="View">
    <button
      class:on={!details}
      disabled={noLib}
      title="Icons{remembered}"
      aria-pressed={!details}
      onclick={() => setLayout(iconsLayout())}><LayoutGrid size={14} /><span>Icons</span></button
    >
    <button
      class:on={details}
      disabled={noLib}
      title="Details{remembered}"
      aria-pressed={details}
      onclick={() => setLayout('list')}><List size={14} /><span>Details</span></button
    >
  </div>

  <label class="zoom" title="Thumbnail size (Ctrl+= and Ctrl+-)">
    <ImageIcon size={13} />
    <input
      type="range"
      min={ZOOM_MIN}
      max={ZOOM_MAX}
      step="10"
      aria-label="Thumbnail size"
      disabled={noLib}
      value={view.thumbSize}
      oninput={(e) => setThumbSize(Number(e.currentTarget.value))}
    />
    <ImageIcon size={17} />
  </label>

  <button
    class="ib"
    title="Sort: {sortLabel(sort)}"
    aria-label="Sort"
    disabled={noLib}
    aria-haspopup="menu"
    onclick={(e) => openMenuBelow(e.currentTarget, sortMenu())}
  >
    <SortIcon size={16} />
  </button>
  <button
    class="ib pip"
    class:on={!!view.filter.color}
    disabled={noLib}
    title="Search by color (Alt+C)"
    aria-label="Search by color"
    onclick={(e) => filterUi.openPopover('color', e.currentTarget)}><Pipette size={16} /></button
  >
  <button
    class="ib"
    class:on={view.filtered}
    bind:this={filterUi.toolbarAnchor}
    disabled={noLib}
    title="Filters and saved filters (Alt+F)"
    aria-label="Filters"
    aria-haspopup="dialog"
    onclick={(e) => filterUi.openPopover('saved', e.currentTarget)}><Funnel size={15} /></button
  >

  <button
    class="cmd"
    onclick={() => ui.openOverlay('command')}
    aria-label="Search, filter, or run a command"
  >
    <Search size={14} />
    <span class="ph">Search, filter, or run a command</span>
    <kbd>Ctrl K</kbd>
  </button>

  <button
    class="ib"
    title={noLib
      ? 'Open a library first'
      : (readOnlyTip() ?? 'Add files, a folder or a new folder')}
    aria-label="Add"
    disabled={noLib}
    aria-haspopup="menu"
    onclick={(e) => openMenuBelow(e.currentTarget, addMenu())}><Plus size={17} /></button
  >
  <!-- Always here (the sidebar can be hidden), so Settings never depends on knowing Ctrl+K. -->
  <button
    class="ib"
    title="Settings (Ctrl+,)"
    aria-label="Settings"
    onclick={() => ui.openDialog('settings')}><Settings size={16} /></button
  >
  <button
    class="ib"
    class:on={ui.inspectorVisible}
    title="Show or hide the inspector (Ctrl+Alt+2)"
    aria-label="Show or hide the inspector"
    aria-pressed={ui.inspectorVisible}
    onclick={() => (ui.inspectorVisible = !ui.inspectorVisible)}><PanelRight size={16} /></button
  >
</div>

<style>
  .tb {
    display: flex;
    align-items: center;
    gap: 4px;
    height: var(--toolbar-h);
    flex: none;
    padding: 0 10px;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
    container-type: inline-size;
    -webkit-app-region: drag;
    user-select: none;
  }
  .tb button,
  .tb label,
  .tb input {
    -webkit-app-region: no-drag;
  }
  .ib {
    display: grid;
    place-items: center;
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 6px;
    color: var(--mu);
  }
  .ib:hover:not(:disabled) {
    background: var(--hov);
    color: var(--tx);
  }
  .ib:disabled {
    color: var(--fa);
    opacity: 0.55;
  }
  .ib.on {
    color: var(--link);
  }
  .ib:focus-visible,
  .cmd:focus-visible {
    outline: 2px solid var(--bl);
    outline-offset: -1px;
  }
  .zoom input:disabled {
    opacity: 0.45;
  }
  .sp {
    flex: 1;
    align-self: stretch;
    min-width: 12px;
  }
  .seg {
    display: flex;
    flex: none;
    margin-right: 12px;
    padding: 2px;
    border-radius: 7px;
    background: var(--fld);
    border: 1px solid var(--line);
  }
  .seg button {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 8px;
    border-radius: 5px;
    color: var(--mu);
    font-size: 12px;
  }
  .seg button:hover:not(:disabled) {
    color: var(--tx);
  }
  .seg button.on {
    background: var(--chip);
    color: var(--tx);
    box-shadow: inset 0 0 0 1px var(--chip-line);
  }
  .seg button:disabled {
    opacity: 0.45;
  }
  .seg button:focus-visible {
    outline: 2px solid var(--bl);
    outline-offset: -1px;
  }
  .zoom {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-right: 10px;
    color: var(--fa);
  }
  .zoom input {
    -webkit-appearance: none;
    appearance: none;
    width: 110px;
    height: 3px;
    border-radius: 3px;
    background: var(--chip-line);
    outline: 0;
  }
  .zoom input::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--tx);
    border: 0;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  }
  .zoom input:focus-visible {
    outline: 2px solid var(--bl);
    outline-offset: 4px;
  }
  .cmd {
    display: flex;
    align-items: center;
    gap: 8px;
    /* The widest thing in the bar: it takes the room up to here and gives it back first. */
    flex: 0 1 440px;
    min-width: 140px;
    height: 32px;
    margin-left: 6px;
    padding: 0 6px 0 11px;
    border-radius: 8px;
    background: var(--fld);
    border: 1px solid var(--chip-line);
    color: var(--mu);
    text-align: left;
    cursor: text;
  }
  .cmd:hover {
    border-color: var(--fa);
  }
  .cmd .ph {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @container (max-width: 1000px) {
    .seg span {
      display: none;
    }
    .zoom input {
      width: 70px;
    }
  }
  /* A 1280 px window with both panels open lands here: the slider stays, its icons go. */
  @container (max-width: 800px) {
    .zoom {
      margin-right: 4px;
    }
    .zoom :global(svg) {
      display: none;
    }
    .zoom input {
      width: 56px;
    }
    .cmd kbd {
      display: none;
    }
  }
  @container (max-width: 700px) {
    .zoom {
      display: none;
    }
  }
  /* Very narrow: the command bar shrinks to its search icon. */
  @container (max-width: 580px) {
    .cmd {
      flex: none;
      min-width: 0;
      width: 32px;
      padding: 0;
      justify-content: center;
    }
    .cmd .ph {
      display: none;
    }
  }
  /* Narrowest window (both panels open). Color search stays in the filter menu; Alt Right still goes forward. */
  @container (max-width: 480px) {
    .pip,
    .fwd {
      display: none;
    }
    .sp {
      min-width: 0;
    }
  }
</style>
