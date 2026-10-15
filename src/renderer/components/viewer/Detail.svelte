<script lang="ts">
  // Detail view: a fixed overlay over the window, except the tab row on top, the inspector column
  // (App keeps drawing the inspector there and it follows the selection, which Viewer.svelte keeps
  // on this item) and the status strip along the bottom, which stays whole under both.
  // It stays mounted while any item tab is open and holds a view for each (TabPane), hidden while
  // the library or another mode is on screen. In a pop-out window it is the whole window.
  import AppWindow from '@lucide/svelte/icons/app-window';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Contrast from '@lucide/svelte/icons/contrast';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import FlipHorizontal from '@lucide/svelte/icons/flip-horizontal';
  import Grid3x3 from '@lucide/svelte/icons/grid-3x3';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import Moon from '@lucide/svelte/icons/moon';
  import PanelRight from '@lucide/svelte/icons/panel-right';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import Sun from '@lucide/svelte/icons/sun';
  import SquareArrowDownLeft from '@lucide/svelte/icons/square-arrow-down-left';
  import SquareArrowOutUpRight from '@lucide/svelte/icons/square-arrow-out-up-right';
  import X from '@lucide/svelte/icons/x';
  import { api, windowKind } from '../../lib/api';
  import { openMenuBelow } from '../../lib/contextMenu.svelte';
  import { items } from '../../lib/stores/items.svelte';
  import { tabs } from '../../lib/stores/tabs.svelte';
  import { ui } from '../../lib/stores/ui.svelte';
  import { openDefault } from '../../lib/files';
  import {
    draggedToTabs,
    dragToTabs,
    openReferenceHere,
    popOut,
    putBack,
    showInMainWindow,
  } from './actions';
  import { openItemMenu } from './menu';
  import IconBtn from './IconBtn.svelte';
  import TabPane from './TabPane.svelte';
  import { viewKind } from '../../lib/fileKinds';
  import { currentId, step } from './nav';
  import { viewer } from './state.svelte';
  import { useItem } from './useItem.svelte';

  const popout = windowKind.kind === 'viewer';
  // On screen: an item tab is, and nothing else (a slideshow started from it) is on top.
  const shown = $derived(!!tabs.active && ui.viewer?.mode === 'detail');
  const id = $derived(shown ? currentId() : undefined);
  const cur = useItem(() => id);
  const item = $derived(cur.value);
  const name = $derived(item?.name ?? (id ? items.brief(id)?.name : '') ?? '');
  // Fonts and audio have no picture to zoom, flip or gray; their buttons would do nothing.
  const stageless = $derived(!!item && ['font', 'audio'].includes(viewKind(item.ext)));
  const total = $derived(ui.viewer?.ids.length ?? 0);
  const index = $derived(ui.viewer?.index ?? 0);

  const zoomLabel = $derived.by(() => {
    const pct = Math.round(viewer.zoom.scale * 100);
    return viewer.zoom.atFit && viewer.zoom.scale < 0.995 ? `Fit · ${pct}%` : `${pct}%`;
  });

  function zoomMenu(e: MouseEvent) {
    const at = (s: number) => viewer.eachStage((st) => st.toScale(s));
    const cur = viewer.zoom.scale;
    const same = (s: number) => !viewer.zoom.atFit && Math.abs(cur - s) < 0.005;
    openMenuBelow(e.currentTarget as HTMLElement, [
      {
        label: 'Fit',
        keys: 'Ctrl+9',
        checked: viewer.zoom.atFit,
        run: () => viewer.eachStage((st) => st.fit()),
      },
      { separator: true },
      { label: '25%', checked: same(0.25), run: () => at(0.25) },
      { label: '50%', checked: same(0.5), run: () => at(0.5) },
      {
        label: '100%',
        keys: 'Ctrl+0',
        checked: same(1),
        run: () => viewer.eachStage((st) => st.actual()),
      },
      { label: '200%', checked: same(2), run: () => at(2) },
      { label: '400%', checked: same(4), run: () => at(4) },
    ]);
  }

  const bgTitle = $derived(
    `Background: ${viewer.bg === 'checker' ? 'checkerboard' : viewer.bg}. Click to change.`,
  );
</script>

<div
  class="detail"
  class:off={!shown}
  class:popout
  inert={!shown}
  style:right={ui.inspectorVisible && !popout ? 'var(--inspector-w)' : '0'}
  role="dialog"
  aria-label="Detail view"
>
  <header class="bar">
    {#if popout}
      <IconBtn
        label="Put back in the tabs"
        title="Put back in the tabs"
        onclick={() => void putBack()}><SquareArrowDownLeft size={17} /></IconBtn
      >
    {:else}
      <IconBtn
        label="Back to the library"
        title="Close this tab and go back (Esc)"
        onclick={() => (ui.viewer = null)}><ArrowLeft size={17} /></IconBtn
      >
    {/if}
    <!-- In a pop-out the title is a handle: drop it on the main window to put it back in the tabs. -->
    <div
      class="title"
      role="group"
      draggable={popout ? 'true' : undefined}
      title={popout ? 'Drag onto the main window to put it back in the tabs' : undefined}
      ondragstart={popout ? dragToTabs : undefined}
      ondragend={popout ? draggedToTabs : undefined}
    >
      <span class="name" title={popout ? undefined : name}>{name}</span>
      <span class="idx">{index + 1} / {total.toLocaleString()}</span>
    </div>
    <span class="sp"></span>
    <button
      type="button"
      class="zoom"
      title="Zoom (Ctrl+= and Ctrl+-, wheel). Fit: Ctrl+9, 100%: Ctrl+0"
      disabled={stageless}
      onclick={zoomMenu}>{stageless ? '' : zoomLabel}</button
    >
    <IconBtn
      label="Flip horizontally"
      title="Flip horizontally (Shift+H)"
      toggle
      disabled={stageless}
      on={viewer.flip}
      onclick={() => (viewer.flip = !viewer.flip)}><FlipHorizontal size={16} /></IconBtn
    >
    <IconBtn
      label="Grayscale"
      title="Grayscale (Ctrl+Alt+G)"
      toggle
      disabled={stageless}
      on={viewer.gray}
      onclick={() => (viewer.gray = !viewer.gray)}><Contrast size={16} /></IconBtn
    >
    <IconBtn
      label="Rotate 90 degrees"
      title="Rotate the view (Shift+R)"
      disabled={stageless}
      on={viewer.rotate !== 0}
      onclick={() => viewer.turn()}><RotateCw size={16} /></IconBtn
    >
    <IconBtn
      label="Background"
      title={bgTitle}
      disabled={stageless}
      onclick={() => viewer.cycleBg()}
    >
      {#if viewer.bg === 'dark'}<Moon size={16} />{:else if viewer.bg === 'checker'}<Grid3x3
          size={16}
        />{:else}<Sun size={16} />{/if}
    </IconBtn>
    <span class="rule"></span>
    {#if !popout}
      <IconBtn
        label="Pop out into its own window"
        title="Pop out into its own window"
        disabled={!tabs.active}
        onclick={() => tabs.active && void popOut(tabs.active)}><AppWindow size={16} /></IconBtn
      >
    {/if}
    <IconBtn
      label="Open in reference window"
      title="Open in reference window (Ctrl+O)"
      disabled={!id}
      onclick={() => id && void openReferenceHere(id)}><SquareArrowOutUpRight size={16} /></IconBtn
    >
    <IconBtn
      label="Open with default app"
      title="Open with default app (Shift+Enter)"
      disabled={!id}
      onclick={() => id && void openDefault(id)}><ExternalLink size={16} /></IconBtn
    >
    {#if popout}
      <IconBtn
        label="Show in library"
        title="Show in the library window"
        disabled={!id}
        onclick={() => id && void showInMainWindow(id)}><LayoutGrid size={16} /></IconBtn
      >
      <span class="rule"></span>
      <IconBtn
        label="Close window"
        title="Close this window (Esc)"
        onclick={() => void api.windowControl('close')}><X size={17} /></IconBtn
      >
    {:else}
      <IconBtn
        label="Info panel"
        title="Show or hide the info panel"
        toggle
        on={ui.inspectorVisible}
        onclick={() => (ui.inspectorVisible = !ui.inspectorVisible)}
        ><PanelRight size={16} /></IconBtn
      >
    {/if}
  </header>

  <div class="body" role="presentation" oncontextmenu={(e) => id && openItemMenu(e, id)}>
    {#each tabs.list as tab (tab.key)}
      {#if tab.key === tabs.active || tabs.seen.has(tab.key)}
        <TabPane {tab} live={shown && tab.key === tabs.active} />
      {/if}
    {/each}
    {#if index > 0}
      <button
        type="button"
        class="nav prev"
        aria-label="Previous item"
        title="Previous (Left or A)"
        onclick={() => step(-1)}><ChevronLeft size={22} /></button
      >
    {/if}
    {#if index < total - 1}
      <button
        type="button"
        class="nav next"
        aria-label="Next item"
        title="Next (Right or D)"
        onclick={() => step(1)}><ChevronRight size={22} /></button
      >
    {/if}
  </div>
</div>

<style>
  .detail {
    position: fixed;
    z-index: 60;
    top: var(--tabs-h, 0px);
    left: 0;
    bottom: var(--strip-h);
    display: flex;
    flex-direction: column;
    background: var(--bg);
    animation: fade 120ms ease-out;
  }
  .off {
    visibility: hidden;
  }
  .popout {
    top: 0;
    bottom: 0;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    height: var(--toolbar-h);
    padding: 0 10px;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }
  /* A pop-out window has no frame: its bar moves it, like the main window's toolbar. */
  .popout .bar {
    -webkit-app-region: drag;
    user-select: none;
  }
  .popout .bar :global(button),
  .popout .bar :global(input) {
    -webkit-app-region: no-drag;
  }
  .popout .title {
    -webkit-app-region: no-drag;
    cursor: grab;
  }
  .title {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
    margin-left: 6px;
  }
  .name {
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .idx {
    flex: none;
    color: var(--fa);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }
  .sp {
    flex: 1;
  }
  .rule {
    width: 1px;
    height: 18px;
    margin: 0 6px;
    background: var(--line);
  }
  .zoom {
    height: 30px;
    border-radius: var(--radius);
    color: var(--mu);
  }
  .zoom {
    padding: 0 10px;
    margin-right: 4px;
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .zoom:hover:not(:disabled) {
    background: var(--hov);
    color: var(--tx);
  }
  .zoom:disabled {
    opacity: 0.5;
  }
  .zoom:focus-visible,
  .nav:focus-visible {
    outline: 2px solid var(--bl);
    outline-offset: -2px;
  }
  .body {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .nav {
    position: absolute;
    top: 50%;
    width: 40px;
    height: 56px;
    margin-top: -28px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.45);
    color: var(--tx);
    opacity: 0;
    transition: opacity 120ms ease-out;
  }
  .nav.prev {
    left: 12px;
  }
  .nav.next {
    right: 12px;
  }
  .body:hover .nav,
  .nav:focus-visible {
    opacity: 0.9;
  }
  .nav:hover {
    background: rgba(0, 0, 0, 0.7);
  }
</style>
