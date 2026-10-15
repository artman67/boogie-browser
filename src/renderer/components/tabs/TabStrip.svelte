<script lang="ts">
  // The tab row along the top of the window, there while an item tab is open: the Library (the
  // grid) first, then a tab for each item open in the detail view. Click to switch; the x or a
  // middle-click closes; drag along the row to reorder, or down out of it to pop the tab out into
  // its own window; right-click for the rest. Its empty part is a window drag area, like the toolbar.
  import { onMount } from 'svelte';
  import AppWindow from '@lucide/svelte/icons/app-window';
  import X from '@lucide/svelte/icons/x';
  import { tabItem, tabs } from '../../lib/stores/tabs.svelte';
  import { view } from '../../lib/stores/view.svelte';
  import { whereYouAre } from '../toolbar/where';
  import { popOut } from '../viewer/actions';
  import { libraryTabMenu, tabMenu } from './actions';
  import TabLabel from './TabLabel.svelte';

  const HEIGHT = 34;
  /** How far below the row a released tab pops out. */
  const POP_OUT_BELOW = 60;

  const where = $derived(whereYouAre());
  const count = $derived(view.result ? view.result.total.toLocaleString() : '');

  // Everything under the row moves down by its height while it is there.
  onMount(() => {
    document.documentElement.style.setProperty('--tabs-h', `${HEIGHT}px`);
    return () => document.documentElement.style.removeProperty('--tabs-h');
  });

  let row = $state<HTMLElement>();
  let drag = $state<{
    key: string;
    sx: number;
    sy: number;
    x: number;
    y: number;
    moved: boolean;
    out: boolean;
  } | null>(null);
  const dragged = $derived(drag?.moved ? tabs.get(drag.key) : undefined);

  function down(e: PointerEvent, key: string) {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag = {
      key,
      sx: e.clientX,
      sy: e.clientY,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      out: false,
    };
  }

  function move(e: PointerEvent) {
    if (!drag) return;
    const moved = drag.moved || Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6;
    const out =
      e.clientY > HEIGHT + POP_OUT_BELOW ||
      e.clientY < 0 ||
      e.clientX < 0 ||
      e.clientX > window.innerWidth;
    drag = { ...drag, x: e.clientX, y: e.clientY, moved, out };
    if (!moved || out || !row) return;
    // Along the row: the tab takes the place of the one under the pointer.
    const at = [...row.querySelectorAll('[data-key]')].findIndex((el) => {
      const r = el.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX < r.right;
    });
    if (at >= 0) tabs.move(drag.key, at);
  }

  function up() {
    const d = drag;
    drag = null;
    if (!d) return;
    if (!d.moved) tabs.show(d.key);
    else if (d.out) void popOut(d.key);
  }

  // Middle-click closes: pressed and released on the same tab (auxclick doesn't always fire).
  let middleOn: string | null = null;
  function middleDown(e: MouseEvent, key: string) {
    if (e.button !== 1) return;
    e.preventDefault();
    middleOn = key;
  }
  function middleUp(e: MouseEvent, key: string) {
    if (e.button === 1 && middleOn === key) tabs.close(key);
    middleOn = null;
  }
</script>

<div class="row" bind:this={row} style:height="{HEIGHT}px" role="tablist" aria-label="Tabs">
  <button
    type="button"
    class="tab lib"
    class:on={!tabs.active}
    role="tab"
    aria-selected={!tabs.active}
    title="The library (Ctrl+1)"
    onclick={() => tabs.show(null)}
    oncontextmenu={libraryTabMenu}
  >
    {#if where.color}
      <where.icon size={15} style="color:{where.color};fill:{where.color}" />
    {:else}
      <where.icon size={15} />
    {/if}
    <span class="nm">{where.name}</span>
    {#if count}<span class="ct">{count}</span>{/if}
  </button>

  {#each tabs.list as tab (tab.key)}
    <div
      class="tab"
      class:on={tabs.active === tab.key}
      class:lift={drag?.moved && drag.key === tab.key}
      data-key={tab.key}
      role="tab"
      tabindex="0"
      aria-selected={tabs.active === tab.key}
      onpointerdown={(e) => down(e, tab.key)}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={() => (drag = null)}
      onmousedown={(e) => middleDown(e, tab.key)}
      onmouseup={(e) => middleUp(e, tab.key)}
      oncontextmenu={(e) => tabMenu(e, tab.key)}
      onkeydown={(e) => e.key === 'Enter' && tabs.show(tab.key)}
    >
      <TabLabel id={tabItem(tab)} />
      <button
        type="button"
        class="x"
        aria-label="Close tab"
        title="Close tab (Ctrl+W)"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={() => tabs.close(tab.key)}><X size={13} /></button
      >
    </div>
  {/each}
</div>

{#if dragged && drag?.out}
  <div class="ghost" style:left="{drag.x + 12}px" style:top="{drag.y + 12}px">
    <AppWindow size={14} />
    <TabLabel id={tabItem(dragged)} />
    <span class="hint">Release to open in its own window</span>
  </div>
{/if}

<style>
  .row {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    box-sizing: border-box;
    padding: 6px 8px 0;
    background: var(--strip);
    border-bottom: 1px solid var(--line);
    font-size: 12.5px;
    color: var(--mu);
    user-select: none;
    -webkit-app-region: drag;
  }
  .tab {
    -webkit-app-region: no-drag;
    position: relative;
    top: 1px;
    display: flex;
    align-items: center;
    gap: 7px;
    flex: 0 1 200px;
    min-width: 60px;
    height: 28px;
    padding: 0 4px 0 9px;
    border: 1px solid transparent;
    border-bottom: none;
    border-radius: 7px 7px 0 0;
    color: inherit;
    font: inherit;
    cursor: default;
  }
  .tab:hover:not(.on) {
    background: var(--hov);
    color: var(--tx);
  }
  .tab.on {
    background: var(--bg);
    color: var(--tx);
    border-color: var(--line);
  }
  .tab:focus-visible {
    outline: 2px solid var(--bl);
    outline-offset: -2px;
  }
  .tab.lift {
    opacity: 0.6;
  }
  .lib {
    flex: 0 1 auto;
    max-width: 240px;
    padding-right: 11px;
  }
  .nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ct {
    flex: none;
    color: var(--fa);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }
  .x {
    flex: none;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    margin-left: auto;
    border-radius: 5px;
    color: var(--fa);
  }
  .x:hover {
    background: var(--hov);
    color: var(--tx);
  }
  .ghost {
    position: fixed;
    z-index: 200;
    display: flex;
    align-items: center;
    gap: 7px;
    max-width: 460px;
    height: 30px;
    padding: 0 10px;
    border-radius: 7px;
    background: var(--panel);
    border: 1px solid var(--panel-line);
    color: var(--tx);
    font-size: 12.5px;
    pointer-events: none;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  }
  .ghost > :global(svg) {
    flex: none;
  }
  .hint {
    flex: none;
    color: var(--fa);
  }
</style>
