<script lang="ts">
  // The Folders section: the tree, inline rename / new folder, drag and drop, keyboard, and
  // virtual scrolling for libraries with thousands of folders (the Art library has 6,554). Also
  // the filter box, focus on one branch, and the pill back to the current folder.
  import { onMount, tick, untrack } from 'svelte';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import Plus from '@lucide/svelte/icons/plus';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Lock from '@lucide/svelte/icons/lock';
  import { library } from '../../lib/stores/library.svelte';
  import { view } from '../../lib/stores/view.svelte';
  import { ui } from '../../lib/stores/ui.svelte';
  import {
    focus,
    registerCommands,
    type Command,
    type CommandContext,
  } from '../../lib/commands.svelte';
  import { openContextMenu, openMenuBelow, type MenuItem } from '../../lib/contextMenu.svelte';
  import { canEdit, readOnlyTip } from '../../lib/edit';
  import type { FolderNode } from '../../../shared/types';
  import FolderGlyph from './FolderGlyph.svelte';
  import InlineInput from './InlineInput.svelte';
  import Section from './Section.svelte';
  import { sections } from './sections.svelte';
  import { expanded } from './expanded.svelte';
  import { treeFocus } from './treeFocus.svelte';
  import { FolderDnd } from './folderDnd.svelte';
  import { folderMenu } from './folderMenu';
  import * as act from './actions';
  import {
    ROW_H,
    VIRTUAL_MIN,
    ancestorIds,
    branchIds,
    branchLevels,
    filterFolders,
    flatten,
    scrollToReveal,
    shorten,
    siblingMove,
    tailStart,
    windowRange,
    type Row,
  } from './tree';

  let {
    scroller,
    scrollTop,
    viewH,
  }: { scroller: HTMLElement | null; scrollTop: number; viewH: number } = $props();

  const NEW_ID = '__new__';
  const NEW_NODE: FolderNode = {
    id: NEW_ID,
    name: '',
    description: '',
    children: [],
    tags: [],
    icon: null,
    iconColor: null,
    coverId: null,
    orderBy: null,
    sortIncrease: null,
    hasPassword: false,
    modificationTime: 0,
  };

  const roots = $derived(library.state?.folders ?? []);
  const ro = $derived(library.readOnly);
  const scopeId = $derived(view.scope.kind === 'folder' ? view.scope.id : null);
  const libraryId = $derived(library.state?.ref.id ?? '');

  // ── focus on one folder: the tree shows only its branch ──
  const focusId = $derived.by(() => {
    const id = treeFocus.get(libraryId);
    return id && library.folders.has(id) ? id : null;
  });
  const treeRoots = $derived.by(() => {
    const node = focusId ? library.folder(focusId)?.node : null;
    return node ? [node] : roots;
  });
  function setFocus(id: string | null) {
    const was = focusId;
    treeFocus.set(libraryId, id);
    if (id) expanded.add([id]);
    void tick().then(() => {
      // Focused: the branch starts at the top of the tree. Back to all: keep that folder in view.
      if (id && scroller && scroller.scrollTop > measure() - 40)
        scroller.scrollTop = Math.max(0, measure() - 40);
      else if (!id && was) scrollToId(was, true);
    });
  }

  // ── the filter box: a flat list of matching folders instead of the tree ──
  let query = $state('');
  let hi = $state(0);
  let resultsEl = $state<HTMLElement | null>(null);
  const filtering = $derived(!!query.trim());
  const found = $derived(filterFolders(library.folders, query));
  function filterKey(e: KeyboardEvent) {
    const hits = found.hits;
    if (e.key === 'ArrowDown') hi = Math.min(hi + 1, hits.length - 1);
    else if (e.key === 'ArrowUp') hi = Math.max(hi - 1, 0);
    else if (e.key === 'Enter') {
      if (hits[hi]) act.openFolder(hits[hi].id);
    } else if (e.key === 'Escape') {
      if (!query) return;
      clearFilter();
    } else return;
    e.preventDefault();
    queueMicrotask(() => resultsEl?.querySelector('.hi')?.scrollIntoView({ block: 'nearest' }));
  }
  function clearFilter() {
    query = '';
    hi = 0;
    // Back in the tree, show where the folder you opened from the list sits.
    if (scopeId) {
      expanded.add(ancestorIds(library.folders, scopeId));
      cursorId = scopeId;
      void tick().then(() => scopeId && scrollToId(scopeId));
    }
  }
  const showCursor = $derived(focus.region === 'sidebar');

  let cursorId = $state<string | null>(null);
  let renamingId = $state<string | null>(null);
  /** The name just typed, shown until the tree refreshes so a rename doesn't flash the old name. */
  let renamed = $state<{ id: string; name: string } | null>(null);
  /** The "new folder" row. `saving` holds the typed name while the request is in flight; `createdId`
   *  is set once the core has made it, and the row stays until the refreshed tree contains it. */
  let creating = $state<{
    parentId: string | null;
    saving: string | null;
    createdId: string | null;
  } | null>(null);
  const inserting = $derived(
    creating && !(creating.createdId && library.folders.has(creating.createdId)) ? creating : null,
  );
  /** Scroll to this folder once a newer library state has arrived (new or moved folders). */
  let pending = $state.raw<{ id: string; base: unknown } | null>(null);
  let treeEl = $state<HTMLElement | null>(null);
  let treeTop = $state(0);

  // ── rows ──
  const baseRows = $derived(flatten(treeRoots, expanded.set));
  const rows = $derived.by(() => {
    if (!inserting) return baseRows;
    const parent = inserting.parentId;
    let at = baseRows.length;
    let depth = 0;
    if (parent) {
      const i = baseRows.findIndex((r) => r.node.id === parent);
      if (i < 0) return baseRows;
      depth = baseRows[i].depth + 1;
      at = i + 1;
      while (at < baseRows.length && baseRows[at].depth > baseRows[i].depth) at++;
    }
    const row: Row<FolderNode> = {
      node: NEW_NODE,
      depth,
      parentId: parent,
      open: false,
      hasChildren: false,
    };
    return [...baseRows.slice(0, at), row, ...baseRows.slice(at)];
  });

  const virtual = $derived(rows.length > VIRTUAL_MIN);
  const range = $derived(windowRange(rows.length, scrollTop, viewH, treeTop));
  const start = $derived(range[0]);
  const end = $derived(range[1]);
  const shown = $derived(rows.slice(start, end));

  // ── the current folder: its parents' trail and the guide lines leading down to it ──
  const path = $derived(scopeId ? [...ancestorIds(library.folders, scopeId), scopeId] : []);
  const onPath = $derived(new Set(path));
  /** Per row, how many of its guide lines are on the way to the current folder (drawn blue). */
  const levels = $derived(branchLevels(rows, path));

  // ── the pill back to the current folder when its row is out of view ──
  const pill = $derived.by(() => {
    if (!scopeId || filtering || !sections.open.folders || !viewH) return null;
    let i = rows.findIndex((r) => r.node.id === scopeId);
    let inside = false; // under a closed parent: aim at that parent
    if (i < 0) {
      for (let k = path.length - 2; k >= 0 && i < 0; k--)
        i = rows.findIndex((r) => r.node.id === path[k]);
      if (i < 0) return null; // outside the focused branch
      inside = true;
    }
    const top = treeTop + i * ROW_H;
    const up = top < scrollTop;
    if (!inside && !up && top + ROW_H <= scrollTop + viewH) return null;
    return { up, name: library.folder(scopeId)?.node.name ?? '' };
  });
  function backToHere() {
    if (!scopeId) return;
    expanded.add(ancestorIds(library.folders, scopeId));
    const id = scopeId;
    void tick().then(() => scrollToId(id, true));
  }

  function measure(): number {
    if (!treeEl || !scroller) return treeTop;
    return Math.round(
      treeEl.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop,
    );
  }

  // Sections above can grow and shrink, so re-measure where the tree starts whenever the view moves.
  $effect(() => {
    void scrollTop;
    void viewH;
    void rows.length;
    const t = measure();
    untrack(() => {
      if (t !== treeTop) treeTop = t;
    });
  });

  /** Bring a row into view: just enough, or (`center`) into the middle when it was far away. */
  function scrollToId(id: string, center = false) {
    if (!scroller || filtering) return;
    const i = rows.findIndex((r) => r.node.id === id);
    if (i < 0) return;
    const top = measure();
    const to = scrollToReveal(i, scroller.scrollTop, scroller.clientHeight, top);
    if (to === null) return;
    scroller.scrollTop = center ? top + i * ROW_H - (scroller.clientHeight - ROW_H) / 2 : to;
  }

  // ── loading, and opening the parents of the folder you're looking at ──
  let revealed = '';
  let lastScope = '';
  $effect(() => {
    const folders = library.folders;
    const id = scopeId;
    const scopeKey = id ? `folder:${id}` : view.scope.kind;
    untrack(() => {
      expanded.load(libraryId);
      // Going to a non-folder view (All, a tag...) puts the keyboard cursor away.
      if (scopeKey !== lastScope) {
        lastScope = scopeKey;
        if (!id) cursorId = null;
      }
      if (!id) return void (revealed = '');
      const key = `${libraryId}:${id}`;
      if (key === revealed || !folders.has(id)) return;
      revealed = key;
      expanded.add(ancestorIds(folders, id));
      cursorId = id;
      void tick().then(() => scrollToId(id));
    });
  });

  // New or moved folders scroll into view once the refreshed tree arrives.
  $effect(() => {
    const p = pending;
    const state = library.state;
    if (!p || state === p.base || !library.folders.has(p.id)) return;
    pending = null;
    void tick().then(() => scrollToId(p.id));
  });
  /** `base` is the library state from before the change, so an already-arrived refresh counts. */
  function scrollWhenRefreshed(id: string, base: unknown) {
    pending = { id, base };
    setTimeout(() => (pending = null), 1500); // a move that changed nothing never refreshes
  }

  // ── expand / collapse ──
  const expandAll = () => expanded.add(branchIds(treeRoots));
  const collapseAll = () => expanded.replace(new Set());
  function toggleAll() {
    const all = branchIds(treeRoots);
    if (all.length && all.every((id) => expanded.set.has(id))) collapseAll();
    else expandAll();
  }

  // ── new folder, rename ──
  function startCreate(parentId: string | null) {
    if (!canEdit()) return;
    // While focused, "new folder" goes into the focused folder; a parent outside it shows all.
    parentId ??= focusId;
    if (focusId && parentId && !baseRows.some((r) => r.node.id === parentId)) {
      const ups = ancestorIds(library.folders, parentId);
      if (!ups.includes(focusId)) treeFocus.set(libraryId, null);
      expanded.add(ups);
    }
    renamingId = null;
    if (!sections.open.folders) sections.toggle('folders');
    if (parentId) expanded.add([parentId]);
    creating = { parentId, saving: null, createdId: null };
    void tick().then(() => scrollToId(NEW_ID));
  }
  async function commitCreate(name: string) {
    const c = creating;
    if (!c) return;
    if (!name) return void (creating = null);
    creating = { ...c, saving: name };
    const base = library.state;
    const id = await act.createFolder(name, c.parentId);
    if (!id) return void (creating = null); // failed: a toast says why
    cursorId = id;
    scrollWhenRefreshed(id, base);
    // Keep the typed name on screen until the new folder shows up in the tree, so it never blinks.
    creating = { ...c, saving: name, createdId: id };
    setTimeout(() => creating?.createdId === id && (creating = null), 1500);
  }
  /** Ctrl+Shift+N: inside the folder you're looking at, else at the top. */
  function newFolderHere() {
    startCreate(scopeId && library.folders.has(scopeId) ? scopeId : null);
  }

  function startRename(id: string | null) {
    if (!id || !library.folders.has(id) || !canEdit()) return;
    creating = null;
    cursorId = id;
    renamingId = id;
  }
  async function commitRename(id: string, name: string) {
    renamingId = null;
    if (!name || name === library.folder(id)?.node.name) return;
    renamed = { id, name };
    // The typed name stays until the tree carries it (or the request failed), so it never blinks back.
    if (!(await act.renameFolder(id, name))) renamed = null;
    else setTimeout(() => renamed?.id === id && (renamed = null), 1500);
  }
  $effect(() => {
    if (renamed && library.folder(renamed.id)?.node.name === renamed.name) renamed = null;
  });

  // ── selecting and keyboard ──
  /** Tabbing into the tree puts the cursor on the open folder (or the first row) so focus is visible. */
  function focusTree(e: FocusEvent) {
    if (cursorId || !baseRows.length || !(e.currentTarget as HTMLElement).matches(':focus-visible'))
      return;
    cursorId = baseRows.some((r) => r.node.id === scopeId) ? scopeId : baseRows[0].node.id;
  }
  function select(node: FolderNode) {
    cursorId = node.id;
    act.openFolder(node.id);
  }

  function cursorIndex(): number {
    return cursorId ? baseRows.findIndex((r) => r.node.id === cursorId) : -1;
  }
  function moveCursor(delta: number) {
    const cur = cursorIndex();
    const next =
      cur < 0
        ? Math.max(
            0,
            baseRows.findIndex((r) => r.node.id === scopeId),
          )
        : Math.min(baseRows.length - 1, Math.max(0, cur + delta));
    cursorId = baseRows[next].node.id;
    scrollToId(cursorId);
  }
  function leftKey() {
    const i = cursorIndex();
    if (i < 0) return;
    const r = baseRows[i];
    if (r.open) expanded.toggle(r.node.id, false);
    else if (r.parentId) ((cursorId = r.parentId), scrollToId(r.parentId));
  }
  function rightKey() {
    const i = cursorIndex();
    if (i < 0) return;
    const r = baseRows[i];
    if (r.hasChildren && !r.open) expanded.toggle(r.node.id, true);
    else if (r.open) ((cursorId = baseRows[i + 1].node.id), scrollToId(cursorId));
  }
  function moveSibling(how: 'up' | 'down' | 'top' | 'bottom') {
    const id = cursorId;
    if (!id || !canEdit()) return;
    const t = siblingMove(library.folders, roots, id, how);
    if (!t) return;
    scrollWhenRefreshed(id, library.state);
    void act.moveFolder(id, t.parentId, t.index);
  }

  // Keys run through the shared command registry only while the sidebar has keyboard focus, and
  // never while a dialog or picker is up. Enter is left alone when a button has focus.
  const active = (c: CommandContext) =>
    c.region === 'sidebar' && !ui.dialog && !ui.picker && !filtering && baseRows.length > 0;
  const notOnButton = () => document.activeElement?.tagName !== 'BUTTON';

  /** Titles for the shortcut sheet. */
  const TITLES: Record<string, string> = {
    cursorUp: 'Folder above',
    cursorDown: 'Folder below',
    collapse: 'Collapse folder',
    expand: 'Expand folder',
    open: 'Open folder',
    rename: 'Rename folder',
    delete: 'Delete folder',
    autoTags: 'Set auto-tags for this folder…',
    folderUp: 'Move folder up',
    folderDown: 'Move folder down',
    folderTop: 'Move folder to the top',
    folderBottom: 'Move folder to the bottom',
  };

  /** A keyboard-only command: not in the palette, wins over generic ones while the sidebar is focused. */
  const keyed = (
    id: string,
    keys: string[],
    run: () => void,
    when: (c: CommandContext) => boolean = active,
  ): Command => ({
    id: `sidebar.${id}`,
    title: TITLES[id] ?? id,
    group: 'Sidebar',
    keys,
    hidden: true,
    priority: 5,
    when,
    run,
  });
  const hasCursor = (c: CommandContext) => active(c) && !!cursorId;

  onMount(() =>
    registerCommands([
      // Run by the global "New folder" (Ctrl+Shift+N, the + menu), which shows the sidebar first.
      {
        id: 'sidebar.newFolder',
        title: 'New folder here',
        hidden: true,
        when: () => !ui.dialog && !ui.picker,
        run: newFolderHere,
      },
      { id: 'sidebar.expandAll', title: 'Expand all folders', group: 'Folders', run: expandAll },
      {
        id: 'sidebar.collapseAll',
        title: 'Collapse all folders',
        group: 'Folders',
        run: collapseAll,
      },
      // `*` is Shift+8 on a US keyboard (the key handler reports digits by code), Shift+* elsewhere.
      // It works from anywhere, as in Eagle, not only while the sidebar has the keyboard.
      {
        id: 'sidebar.toggleAll',
        mainWindow: true,
        title: 'Expand or collapse all folders',
        group: 'Folders',
        keys: ['*', 'Shift+*', 'Shift+8'],
        hidden: true,
        when: (c) =>
          c.region !== 'overlay' && !ui.viewer && !ui.dialog && !ui.picker && treeRoots.length > 0,
        run: toggleAll,
      },
      { ...keyed('cursorUp', ['ArrowUp'], () => moveCursor(-1)), repeat: true },
      { ...keyed('cursorDown', ['ArrowDown'], () => moveCursor(1)), repeat: true },
      { ...keyed('collapse', ['ArrowLeft'], leftKey), repeat: true },
      { ...keyed('expand', ['ArrowRight'], rightKey), repeat: true },
      // As in Eagle, Enter renames the folder under the cursor (so do F2 and Ctrl+R); a click or
      // Space opens it.
      keyed(
        'open',
        ['Space'],
        () => cursorId && act.openFolder(cursorId),
        (c) => hasCursor(c) && notOnButton(),
      ),
      keyed(
        'rename',
        ['Enter', 'F2', 'Ctrl+R'],
        () => startRename(cursorId),
        (c) => hasCursor(c) && notOnButton(),
      ),
      keyed('delete', ['Delete'], () => cursorId && act.deleteFolder(cursorId), hasCursor),
      keyed(
        'autoTags',
        ['Ctrl+Shift+R'],
        () => void (canEdit() && ui.openDialog('folderEdit', { id: cursorId, focus: 'tags' })),
        hasCursor,
      ),
      // Eagle's keys: Ctrl+] up, Ctrl+[ down, with Shift to the top or the bottom.
      keyed('folderUp', ['Ctrl+]'], () => moveSibling('up')),
      keyed('folderDown', ['Ctrl+['], () => moveSibling('down')),
      keyed('folderTop', ['Ctrl+Shift+]', 'Ctrl+Shift+}'], () => moveSibling('top')),
      keyed('folderBottom', ['Ctrl+Shift+[', 'Ctrl+Shift+{'], () => moveSibling('bottom')),
    ]),
  );

  // ── menus ──
  function rowMenu(e: MouseEvent, node: FolderNode) {
    cursorId = node.id;
    openContextMenu(
      e,
      folderMenu(node, {
        newSub: () => startCreate(node.id),
        rename: () => startRename(node.id),
        focusedId: focusId,
        focus: setFocus,
      }),
    );
  }
  const headerItems = (): MenuItem[] => [
    {
      label: 'New folder',
      disabled: ro,
      title: readOnlyTip(),
      run: () => startCreate(null),
    },
    {
      label: 'New smart folder…',
      disabled: ro,
      title: readOnlyTip(),
      run: () => ui.openDialog('smartFolderEdit', {}),
    },
    { separator: true },
    { label: 'Expand all folders', keys: '*', run: expandAll },
    {
      label: 'Sort folders A to Z',
      disabled: ro,
      title: readOnlyTip(),
      run: () => void act.sortFoldersAZ(null),
    },
    { label: 'Collapse all folders', run: collapseAll },
    ...(focusId
      ? [{ separator: true }, { label: 'Show all folders', run: () => setFocus(null) }]
      : []),
  ];
  let menuBtn = $state<HTMLButtonElement | null>(null);

  const dnd = new FolderDnd({ roots: () => roots, readOnly: () => ro, tree: () => treeEl });

  const countOf = (id: string): number | undefined => {
    const c = library.counts?.folders[id];
    return c?.deep; // everything under it, so a folder of folders doesn't read as empty
  };
  const nameOf = (node: FolderNode) => (renamed?.id === node.id ? renamed.name : node.name);
</script>

<Section
  id="folders"
  title="Folders"
  count={library.folders.size}
  oncontextmenu={(e) => openContextMenu(e, headerItems())}
>
  {#snippet actions()}
    <button
      class="sb-ib"
      aria-label="New folder"
      title={readOnlyTip() ?? 'New folder'}
      disabled={ro}
      onclick={() => startCreate(null)}><Plus size={14} /></button
    >
    <button
      class="sb-ib"
      bind:this={menuBtn}
      aria-label="Folder options"
      aria-haspopup="menu"
      title="More"
      onclick={() => menuBtn && openMenuBelow(menuBtn, headerItems())}
      ><Ellipsis size={14} /></button
    >
  {/snippet}

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
        {@const n = countOf(h.id)}
        {@const q = query.trim().length}
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
              >{h.name.slice(0, h.at)}<mark>{h.name.slice(h.at, h.at + q)}</mark>{h.name.slice(
                h.at + q,
              )}</span
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
  {:else if focusId}
    <button class="sb-row back" onclick={() => setFocus(null)}
      ><ChevronLeft size={13} />All folders</button
    >
  {/if}
  <div
    class="list"
    class:virtual
    hidden={filtering}
    role="tree"
    tabindex="0"
    aria-label="Folders"
    aria-activedescendant={cursorId ? `fr-${cursorId}` : undefined}
    bind:this={treeEl}
    style:height={virtual ? `${rows.length * ROW_H}px` : undefined}
    ondragleave={dnd.leave}
    onfocus={focusTree}
  >
    <div class="win" style:top={virtual ? `${start * ROW_H}px` : undefined}>
      {#each shown as row, i (row.node.id)}
        {@const node = row.node}
        {@const isNew = node.id === NEW_ID}
        {@const n = countOf(node.id)}
        {@const name = nameOf(node)}
        {@const cut = tailStart(name)}
        <!-- Keys go through the command registry and the tree container holds focus (aria-activedescendant),
             so rows are neither key handlers nor tab stops. -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
        <div
          class="sb-row tree"
          class:open={row.open}
          class:sel={scopeId === node.id}
          class:anc={scopeId !== node.id && onPath.has(node.id)}
          class:top={row.depth === 0}
          class:cur={showCursor && cursorId === node.id && scopeId !== node.id}
          class:dz-inside={dnd.hover?.id === node.id && dnd.hover.zone === 'inside'}
          class:dz-before={dnd.hover?.id === node.id && dnd.hover.zone === 'before'}
          class:dz-after={dnd.hover?.id === node.id && dnd.hover.zone === 'after'}
          class:dragging={dnd.dragId === node.id}
          id="fr-{node.id}"
          role="treeitem"
          aria-selected={scopeId === node.id}
          aria-level={row.depth + 1}
          aria-expanded={row.hasChildren ? row.open : undefined}
          style:--d={row.depth}
          style:--b={levels[start + i] || undefined}
          title={isNew ? undefined : node.name}
          draggable={!ro && !isNew && renamingId !== node.id}
          onclick={() => !isNew && select(node)}
          oncontextmenu={(e) => (isNew ? e.preventDefault() : rowMenu(e, node))}
          ondragstart={(e) => dnd.start(e, node)}
          ondragend={dnd.end}
          ondragover={(e) => !isNew && dnd.over(e, row)}
          ondrop={(e) => !isNew && dnd.drop(e, row)}
        >
          {#if row.hasChildren}
            <button
              class="sb-car"
              tabindex="-1"
              aria-label={row.open ? 'Collapse' : 'Expand'}
              onclick={(e) => (e.stopPropagation(), expanded.toggle(node.id))}
              ><ChevronRight size={12} /></button
            >
          {:else}
            <span class="sb-car"></span>
          {/if}
          <FolderGlyph color={node.iconColor} icon={node.icon} />
          {#if isNew && inserting && !inserting.saving}
            <InlineInput
              label="New folder name"
              placeholder="Folder name"
              oncommit={commitCreate}
              oncancel={() => (creating = null)}
            />
          {:else if isNew}
            <span class="fn saving">{inserting?.saving}</span>
          {:else if renamingId === node.id}
            <InlineInput
              value={node.name}
              label="Folder name"
              oncommit={(v) => commitRename(node.id, v)}
              oncancel={() => (renamingId = null)}
            />
          {:else}
            <!-- A long name is cut in the middle, never at its end, so similar names stay apart. -->
            <span
              class="fn"
              class:split={cut < name.length}
              role="presentation"
              ondblclick={() => startRename(node.id)}
              >{#if cut < name.length}<span class="fh">{name.slice(0, cut)}</span><span class="ft"
                  >{name.slice(cut)}</span
                >{:else}{name}{/if}</span
            >
            {#if node.hasPassword}<span class="lk" title="Locked in Eagle"
                ><Lock size={11} aria-label="Locked in Eagle" /></span
              >{/if}
            {#if n}<span class="sb-ct">{n.toLocaleString()}</span>{/if}
          {/if}
        </div>
      {/each}
    </div>
  </div>
  {#if !roots.length && !inserting}
    <div class="sb-hint">No folders yet.{ro ? '' : ' Use + to make one.'}</div>
  {/if}
</Section>

{#if pill}
  <button class="pill" class:up={pill.up} onclick={backToHere} title="Show the current folder"
    >{#if pill.up}<ArrowUp size={12} />{:else}<ArrowDown size={12} />{/if}<span>{pill.name}</span
    ></button
  >
{/if}

<style>
  .list {
    outline: none;
  }
  .list.virtual {
    position: relative;
    overflow: hidden;
  }
  .list.virtual .win {
    position: absolute;
    left: 0;
    right: 0;
  }
  .saving {
    color: var(--mu);
  }
  .lk {
    display: inline-flex;
    flex: none;
    color: var(--fa);
    margin-left: 2px;
  }
  .back {
    height: 24px;
    gap: 5px;
    margin-bottom: 2px;
    color: var(--link);
    font-size: 12px;
  }
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
  /* Floats over the sidebar's scroll area: its containing block is .sb-body, not the scroller,
     so it neither scrolls nor gets clipped. */
  .pill {
    position: absolute;
    left: 50%;
    bottom: 10px;
    z-index: 3;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: calc(100% - 40px);
    height: 24px;
    padding: 0 11px 0 9px;
    border-radius: 99px;
    background: var(--bl);
    color: white;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }
  .pill.up {
    bottom: auto;
    top: 10px;
  }
  .pill :global(svg) {
    flex: none;
  }
  .pill span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
