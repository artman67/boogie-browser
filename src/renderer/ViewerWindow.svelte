<script lang="ts">
  // A tab popped out into its own window: the detail view and nothing else, with all its buttons
  // and keys (the arrows step through the list it was opened with). It follows the library the
  // main window has open, never saves tabs, and closes when its item goes or the library changes.
  import { onMount } from 'svelte';
  import { api, windowKind } from './lib/api';
  import { installKeyHandler, registerCommands } from './lib/commands.svelte';
  import { itemCommands } from './lib/appCommands/items';
  import { items } from './lib/stores/items.svelte';
  import { library } from './lib/stores/library.svelte';
  import { tabItem, tabs } from './lib/stores/tabs.svelte';
  import Viewer from './components/viewer/Viewer.svelte';
  import Pickers from './components/pickers/Pickers.svelte';
  import Dialogs from './components/dialogs/Dialogs.svelte';
  import Toasts from './components/status/Toasts.svelte';
  import ContextMenu from './lib/ui/ContextMenu.svelte';

  let opened = $state(false);
  let libraryId: string | undefined;
  const close = () => void api.windowControl('close');

  onMount(() => {
    const uninstall = installKeyHandler(window);
    const offCommands = registerCommands([
      ...itemCommands(),
      {
        id: 'window.close',
        title: 'Close window',
        group: 'Window',
        keys: ['Ctrl+W'],
        when: (c) => c.region !== 'overlay',
        run: close,
      },
    ]);
    items.subscribe();
    void (async () => {
      await library.attach();
      libraryId = library.state?.ref.id;
      const id = windowKind.itemId;
      const ids = windowKind.itemIds?.length ? windowKind.itemIds : id ? [id] : [];
      tabs.open(ids, Math.max(0, id ? ids.indexOf(id) : 0));
      opened = true;
    })();
    return () => (uninstall(), offCommands());
  });

  // Esc, the last item leaving the list, or another library in the main window: nothing to show.
  $effect(() => {
    if (opened && !tabs.list.length) close();
  });
  $effect(() => {
    const now = library.state?.ref.id;
    if (opened && libraryId && now !== libraryId) close();
  });

  // The window's title is the item's (the taskbar and window switchers show it).
  $effect(() => {
    const id = tabs.list[0] && tabItem(tabs.list[0]);
    const name = id ? (items.full(id)?.name ?? items.brief(id)?.name) : undefined;
    document.title = name ? `${name} - Boogie Browser` : 'Boogie Browser';
  });
</script>

<Viewer />
<Pickers />
<Dialogs />
<Toasts />
<ContextMenu />
