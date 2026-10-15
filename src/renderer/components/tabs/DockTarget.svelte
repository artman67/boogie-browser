<script lang="ts">
  // The main window takes a pop-out back: its title dragged in from the pop-out window (TAB_DRAG)
  // and dropped anywhere here becomes a tab again, at the drop spot when dropped on the tab row.
  // Caught before the grid's and the sidebar's own drop handling, which never see it.
  import SquareArrowDownLeft from '@lucide/svelte/icons/square-arrow-down-left';
  import { tabItem, tabs } from '../../lib/stores/tabs.svelte';
  import { TAB_DRAG } from '../viewer/actions';

  let over = $state(false);
  let leave: ReturnType<typeof setTimeout> | undefined;
  const ours = (e: DragEvent) => !!e.dataTransfer?.types.includes(TAB_DRAG);

  function dragover(e: DragEvent) {
    if (!ours(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer!.dropEffect = 'move';
    over = true;
    // No reliable dragleave across the window's children: it ends when the dragovers stop.
    clearTimeout(leave);
    leave = setTimeout(() => (over = false), 150);
  }

  function drop(e: DragEvent) {
    if (!ours(e)) return;
    e.preventDefault();
    e.stopPropagation();
    over = false;
    let got: { id?: unknown; ids?: unknown };
    try {
      got = JSON.parse(e.dataTransfer!.getData(TAB_DRAG));
    } catch {
      return;
    }
    const { id, ids } = got;
    if (typeof id !== 'string' || !Array.isArray(ids) || !ids.every((x) => typeof x === 'string'))
      return;
    // On the tab row: before the first tab whose middle is right of the pointer.
    const row = [...document.querySelectorAll('[aria-label=Tabs] [data-key]')];
    const at = row.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY <= r.bottom && e.clientX < r.left + r.width / 2;
    });
    tabs.open(ids, Math.max(0, ids.indexOf(id)));
    const t = tabs.list.find((x) => tabItem(x) === id);
    if (t && at >= 0) tabs.move(t.key, at);
  }
</script>

<svelte:window ondragovercapture={dragover} ondropcapture={drop} />

{#if over}
  <div class="dock">
    <span><SquareArrowDownLeft size={16} /> Drop to put it back in the tabs</span>
  </div>
{/if}

<style>
  .dock {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: grid;
    place-items: center;
    border: 2px dashed var(--bl);
    background: rgba(0, 0, 0, 0.25);
    pointer-events: none;
  }
  span {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-radius: 8px;
    background: var(--panel);
    border: 1px solid var(--panel-line);
    color: var(--tx);
    font-size: 13px;
  }
</style>
