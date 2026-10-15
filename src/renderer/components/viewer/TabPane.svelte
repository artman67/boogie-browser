<script lang="ts">
  // One tab's view. Every tab that has been on screen keeps one, hidden while another tab shows,
  // so going back finds the book on its page, the picture at its zoom and the video where it was.
  import type { Tab } from '../../lib/stores/tabs.svelte';
  import { tabItem } from '../../lib/stores/tabs.svelte';
  import ItemView from './ItemView.svelte';
  import { closeViewer } from './commands';
  import { setLive } from './live';
  import { useItem } from './useItem.svelte';

  let { tab, live }: { tab: Tab; live: boolean } = $props();
  setLive(() => live);

  const id = $derived(tabItem(tab));
  const cur = useItem(() => id);
  const item = $derived(cur.value);
</script>

<!-- Hidden, not removed: a PDF reloads at page 1 if its frame leaves the page. -->
<div class="pane" class:off={!live} inert={!live}>
  {#key id}
    {#if item}
      <!-- Double-click on the picture closes the view, as in Eagle (Ctrl+0 / Ctrl+9 and the zoom
           menu do 100% and fit). -->
      <ItemView {item} variant="detail" ondblclick={closeViewer} />
    {:else if item === null}
      <p class="gone">This item isn’t available any more.</p>
    {/if}
  {/key}
</div>

<style>
  .pane {
    position: absolute;
    inset: 0;
  }
  /* visibility, not display: a hidden tab keeps its size, so its zoom and fit stay put */
  .off {
    visibility: hidden;
  }
  .gone {
    display: grid;
    place-items: center;
    height: 100%;
    margin: 0;
    color: var(--fa);
  }
</style>
