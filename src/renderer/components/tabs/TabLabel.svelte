<script lang="ts">
  // An item tab's thumbnail and name (loaded on its own: the item may not be in the grid's view).
  import { items } from '../../lib/stores/items.svelte';
  import { useItem } from '../viewer/useItem.svelte';

  let { id }: { id: string } = $props();
  const cur = useItem(() => id);
  const name = $derived(cur.value?.name ?? items.brief(id)?.name ?? '');
  const thumb = $derived(cur.value?.thumbUrl ?? items.brief(id)?.thumbUrl);
</script>

{#if thumb}<img src={thumb} alt="" draggable="false" />{:else}<span class="ph"></span>{/if}
<span class="nm" title={name}>{cur.value === null ? 'Gone' : name}</span>

<style>
  img,
  .ph {
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 3px;
    object-fit: cover;
    background: var(--hov);
  }
  .nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
