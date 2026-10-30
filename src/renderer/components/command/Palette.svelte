<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Search from '@lucide/svelte/icons/search';
  import { api } from '../../lib/api';
  import { commands, focus, type CommandContext } from '../../lib/commands.svelte';
  import { editItems, fail } from '../../lib/edit';
  import { plural, quoted } from '../../lib/format';
  import { pushRecent, readList } from '../../lib/storage';
  import { canonicalTag } from '../../lib/tags';
  import { library } from '../../lib/stores/library.svelte';
  import { selection } from '../../lib/stores/selection.svelte';
  import { ui } from '../../lib/stores/ui.svelte';
  import { view } from '../../lib/stores/view.svelte';
  import { filterUi } from '../filters/filterUi.svelte';
  import { iconFor } from '../pickers/icons';
  import { rememberFolder } from '../../lib/lastFolder';
  import Modal from '../pickers/Modal.svelte';
  import { whereYouAre } from '../toolbar/where';
  import { FOLDER_COLORS, type Scope } from '../../../shared/types';
  import { buildPalette, type PaletteInput, type PaletteRow, type Place } from './paletteModel';

  let { initial, onclose }: { initial: string; onclose: () => void } = $props();

  const RECENT_KEY = 'recentCommands';
  let text = $state(untrack(() => initial));
  let hi = $state(0);
  let expanded = $state<string | null>(null);
  let images = $state.raw<PaletteInput['images']>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLDivElement | null>(null);
  const recentIds = readList(RECENT_KEY);
  const searchKey = `recentSearches.${library.state?.ref.id ?? 'none'}`;
  const recentSearches = readList(searchKey);
  // Commands are judged from where you opened the palette (the grid, the sidebar, the viewer...),
  // not from the palette itself, so it offers what the window behind it can do. Read before this
  // palette's own overlay takes the keyboard.
  const from: CommandContext = untrack(() => ({
    region: focus.region === 'overlay' ? focus.underOverlay : focus.region,
  }));
  // A search covers the whole library unless you narrow it to where you are. Ctrl+F with a search
  // already on opens with its words, to refine them where they are.
  const here = untrack(() => whereYouAre());
  const narrowable = untrack(() => view.scope.kind !== 'all');
  let everywhere = $state(untrack(() => !initial));
  const wide = $derived(everywhere || !narrowable);

  // Every folder and smart folder with the names above it and the items in it and under it.
  const places = $derived.by((): Place[] => {
    const counts = library.counts;
    const out: Place[] = [];
    for (const [id, f] of library.folders)
      out.push({
        kind: 'folder',
        id,
        name: f.node.name,
        parents: f.path.slice(0, -1),
        parentId: f.parentId,
        count: counts?.folders[id]?.deep ?? 0,
        color: f.node.iconColor ? FOLDER_COLORS[f.node.iconColor] : null,
      });
    const parentOf = new Map<string, string>();
    for (const n of library.smartFolders.values())
      for (const c of n.children) parentOf.set(c.id, n.id);
    for (const [id, n] of library.smartFolders) {
      const parents: string[] = [];
      for (let p = parentOf.get(id); p; p = parentOf.get(p))
        parents.unshift(library.smartFolders.get(p)?.name ?? '');
      out.push({
        kind: 'smartFolder',
        id,
        name: n.name,
        parents,
        parentId: null,
        count: counts?.smartFolders[id] ?? 0,
        color: n.iconColor ? FOLDER_COLORS[n.iconColor] : null,
      });
    }
    return out;
  });

  const sections = $derived(
    buildPalette({
      text,
      selectionCount: selection.count,
      canEdit: !library.readOnly,
      currentKeywords: view.filter.keywords ?? '',
      places,
      tags: library.tags,
      images,
      expanded,
      commands: commands.enabled(from).filter((c) => !c.hidden),
      recentCommandIds: recentIds,
      recentSearches,
      libraries: library.known
        .filter((k) => k.exists && k.path !== library.state?.ref.path)
        .map((k) => ({ path: k.path, name: k.name })),
    }),
  );
  const flat = $derived(sections.flatMap((s) => s.rows));
  // Index of each section's first row, for Tab.
  const starts = $derived(
    sections.map((_, i) => sections.slice(0, i).reduce((n, s) => n + s.rows.length, 0)),
  );
  const cur = $derived(flat[hi] as PaletteRow | undefined);

  onMount(() => {
    inputEl?.focus();
    inputEl?.select();
  });

  $effect(() => {
    void text;
    hi = 0;
    expanded = null;
  });

  // The scope a search would show, and its filter: the other filters stay on unless the search
  // leaves the folder (then they go, as they do when you change folders without the lock).
  const searchScope = (): Scope =>
    wide ? { kind: 'all' } : ($state.snapshot(view.scope) as Scope);
  const keepFilter = () => !wide || view.scope.kind === 'all' || filterUi.lock;

  // A preview of the keyword search as you type (debounced; a late answer is dropped).
  let seq = 0;
  $effect(() => {
    const q = text.trim();
    const scope = searchScope();
    const filter = keepFilter()
      ? { ...$state.snapshot(view.filter), keywords: q }
      : { keywords: q };
    const mine = ++seq;
    if (!q) return void (images = null);
    const t = setTimeout(async () => {
      try {
        const res = await api.query({
          scope,
          filter,
          sort: null,
          looksLike: q,
          looksByFolder: true,
        });
        const briefs = res.ids.length ? await api.getBriefs(res.ids.slice(0, 9)) : [];
        if (mine !== seq) return;
        // Pictures that look like the words count too, folded away or not.
        const looksStart = res.sections?.find((s) => s.kind === 'looks')?.start ?? res.ids.length;
        images = {
          total: looksStart + (res.looksTotal ?? 0),
          thumbs: briefs.map((b) => ({ id: b.id, url: b.thumbUrl })),
        };
      } catch {
        if (mine === seq) images = null;
      }
    }, 120);
    return () => clearTimeout(t);
  });

  async function run(row: PaletteRow, alt = false) {
    const a = alt && row.alt ? row.alt.action : row.action;
    if (a.kind === 'none') return;
    if (a.kind === 'toggleInside') return toggle(a.id);
    const ids = selection.inOrder(view.result?.ids);
    // Close first and let the palette unmount: the action may open another overlay, and a command
    // must run with the keyboard back where the palette was opened from.
    onclose();
    await tick();
    try {
      switch (a.kind) {
        case 'search': {
          const q = a.text.trim();
          if (q && wide && view.scope.kind !== 'all')
            view.setScope({ kind: 'all' }, { keepFilter: filterUi.lock });
          view.setFilter({ keywords: q || undefined });
          if (q) pushRecent(searchKey, q, 5);
          break;
        }
        case 'clearSearch':
          view.setFilter({ keywords: undefined });
          break;
        case 'addTag': {
          const tag = canonicalTag(a.tag);
          await editItems(
            ids,
            { addTags: [tag] },
            {
              done: `Added the tag ${quoted(tag)} to ${plural(ids.length, 'item')}`,
            },
          );
          break;
        }
        case 'showTag':
          view.setScope({ kind: 'tag', name: a.tag }, { keepFilter: filterUi.lock });
          break;
        case 'goFolder':
          view.setScope(
            a.folder === 'folder'
              ? { kind: 'folder', id: a.id, includeSubfolders: view.showSubfolderContents }
              : { kind: 'smartFolder', id: a.id },
            { keepFilter: filterUi.lock },
          );
          break;
        case 'addToFolder':
          if (
            await editItems(
              ids,
              { addFolders: [a.id] },
              {
                done: `Added ${plural(ids.length, 'item')} to ${quoted(a.name)}`,
              },
            )
          )
            rememberFolder(a.id);
          break;
        case 'command':
          pushRecent(RECENT_KEY, a.id, 5);
          if (!(await commands.run(a.id))) ui.toast('That can’t run here', { kind: 'warn' });
          break;
        case 'library':
          await library.open(a.path); // the store starts the view over for the new library
          break;
      }
    } catch (e) {
      fail(e);
    }
  }

  /** List (or hide) the matching folders inside a folder row, keeping that row highlighted. */
  function toggle(id: string) {
    expanded = expanded === id ? null : id;
    void tick().then(() => {
      const i = flat.findIndex((r) => r.key === `go:${id}`);
      if (i >= 0) hi = i;
    });
  }

  function move(to: number) {
    if (!flat.length) return;
    hi = (to + flat.length) % flat.length;
    void tick().then(() => listEl?.querySelector('.po.on')?.scrollIntoView({ block: 'nearest' }));
  }

  function jumpSection(dir: 1 | -1) {
    if (!starts.length) return;
    let cur = starts.findLastIndex((s) => s <= hi);
    cur = (cur + dir + starts.length) % starts.length;
    move(starts[cur]);
  }

  function onkey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') move(hi + 1);
    else if (e.key === 'ArrowUp') move(hi - 1);
    else if (e.key === 'Tab') jumpSection(e.shiftKey ? -1 : 1);
    else if (e.key === 'Enter') {
      if (cur) void run(cur, e.ctrlKey || e.metaKey);
    } else if (
      (e.key === 'ArrowRight' || e.key === 'ArrowLeft') &&
      inputEl?.selectionStart === text.length &&
      cur
    ) {
      // With the caret at the end, → lists the folders inside the highlighted one, ← hides them.
      const open = e.key === 'ArrowRight';
      if (open && cur.inside && !cur.open)
        toggle(cur.action.kind === 'goFolder' ? cur.action.id : '');
      else if (!open && expanded && (cur.open || cur.nested)) toggle(expanded);
      else return;
    } else return;
    e.preventDefault();
  }
</script>

<Modal {onclose} label="Command palette" width={640} top="13vh">
  <!-- Clicks anywhere in the palette keep the keyboard in its input, so keys never reach the
       window behind while it's open. -->
  <div
    class="pal"
    role="presentation"
    onmousedown={(e) => e.target !== inputEl && e.preventDefault()}
  >
    <div class="pin">
      <Search size={18} />
      <input
        bind:this={inputEl}
        data-autofocus
        placeholder="Search, filter, or run a command"
        aria-label="Search, filter, or run a command"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        autocomplete="off"
        spellcheck="false"
        bind:value={text}
        onkeydown={onkey}
      />
      {#if narrowable}
        <button
          class="scope"
          title="Search the whole library or just {here.name}"
          onclick={() => (everywhere = !everywhere)}
          >{everywhere ? 'Everywhere' : `In ${here.name}`}</button
        >
      {/if}
      {#if selection.count}<span class="ctx">{selection.count.toLocaleString()} selected</span>{/if}
    </div>
    <div class="pg" id="palette-list" role="listbox" bind:this={listEl}>
      {#each sections as sec, si (sec.title)}
        <h6>
          {sec.title}{#if sec.detail}<span>{sec.detail}</span>{/if}
        </h6>
        {#if sec.strip}
          <div class="strip" role="presentation">
            {#each sec.strip as t (t.id)}
              <img
                src={t.url}
                alt=""
                loading="lazy"
                onclick={() => run(sec.rows[0])}
                onkeydown={() => {}}
                role="presentation"
              />
            {/each}
          </div>
        {/if}
        {#each sec.rows as row, ri (row.key)}
          {@const i = starts[si] + ri}
          {@const Icon = iconFor(row.icon)}
          <div
            class="po"
            class:on={i === hi}
            class:big={row.big}
            class:nested={row.nested}
            class:note={row.note}
            role="option"
            tabindex="-1"
            aria-selected={i === hi}
            onmousedown={(ev) => ev.preventDefault()}
            onclick={(ev) => run(row, ev.ctrlKey || ev.metaKey)}
            onkeydown={() => {}}
            onmousemove={() => (hi = i)}
          >
            <Icon size={row.big ? 18 : 16} color={row.color ?? undefined} />
            <span class="lb"
              >{#each row.segs as s, j (j)}{#if s.hit}<mark>{s.text}</mark
                  >{:else}{s.text}{/if}{/each}</span
            >
            {#if row.where}<span class="w">{row.where}</span>{/if}
            {#if row.detail}<span class="d">{row.detail}</span>{/if}
            {#if row.inside}
              <button
                class="in"
                class:open={row.open}
                onclick={(ev) => {
                  ev.stopPropagation();
                  if (row.action.kind === 'goFolder') toggle(row.action.id);
                }}>{row.inside} more inside<ChevronRight size={13} /></button
              >
            {/if}
            {#if row.keys}<kbd>{row.keys}</kbd>{:else if i === hi && !row.note}<kbd>Enter</kbd>{/if}
          </div>
        {/each}
      {/each}
    </div>
    <div class="pfoot">
      {#if cur?.path || cur?.alt}
        {#if cur.path}<span class="path">{cur.path}</span>{/if}
        {#if cur.alt}<span class="alt"><kbd>Ctrl Enter</kbd> {cur.alt.label}</span>{/if}
      {:else}
        <span>↑ ↓ to move</span><span>Enter to run</span><span>Tab for the next group</span><span
          >Esc to close</span
        >
      {/if}
    </div>
  </div>
</Modal>

<style>
  .pal {
    display: contents;
  }
  .pin {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 54px;
    padding: 0 16px;
    border-bottom: 1px solid var(--line);
    color: var(--fa);
    flex: none;
  }
  .pin input {
    flex: 1;
    min-width: 0;
    height: 100%;
    background: none;
    border: 0;
    outline: none;
    font-size: 16px;
    color: var(--tx);
    caret-color: var(--link);
  }
  .pin input::placeholder {
    color: var(--fa);
  }
  .scope {
    flex: none;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 2px 9px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: none;
    font-size: 12px;
    color: var(--mu);
  }
  .scope:hover {
    color: var(--tx);
  }
  .ctx {
    font-size: 12px;
    white-space: nowrap;
  }
  .pg {
    padding: 4px 8px 6px;
    overflow: auto;
    min-height: 0;
  }
  h6 span {
    margin-left: 8px;
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
  }
  .strip {
    display: flex;
    gap: 4px;
    padding: 0 10px 6px;
    overflow: hidden;
  }
  .strip img {
    width: 52px;
    height: 52px;
    flex: none;
    object-fit: cover;
    border-radius: 5px;
    background: var(--bls);
  }
  h6 {
    margin: 0;
    padding: 10px 10px 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fa);
  }
  .po {
    display: flex;
    align-items: center;
    gap: 11px;
    height: 38px;
    padding: 0 10px;
    border-radius: 8px;
    font-size: 13.5px;
    cursor: default;
  }
  .po :global(svg) {
    color: var(--mu);
    flex: none;
  }
  .po.on {
    background: var(--bls);
  }
  .po.big {
    height: 46px;
    font-size: 15px;
    font-weight: 500;
  }
  .po.nested {
    padding-left: 34px;
  }
  .po.note {
    color: var(--fa);
  }
  .w {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fa);
    font-size: 12.5px;
    font-weight: 400;
  }
  .in {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 1px 4px 1px 7px;
    border: 0;
    border-radius: 5px;
    background: none;
    font-size: 12px;
    color: var(--mu);
    white-space: nowrap;
  }
  .in:hover {
    background: var(--line);
  }
  .in.open :global(svg) {
    transform: rotate(90deg);
  }
  .lb {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .d {
    color: var(--fa);
    font-size: 12.5px;
    white-space: nowrap;
  }
  .po kbd {
    margin-left: auto;
  }
  .lb {
    flex: 0 1 auto;
  }
  .lb + .d,
  .lb + kbd,
  .lb + .in {
    margin-left: auto;
  }
  .d + kbd,
  .d + .in,
  .in + kbd {
    margin-left: 0;
  }
  mark {
    background: none;
    color: var(--link);
    font-weight: 600;
  }
  .pfoot .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pfoot .alt {
    flex: none;
    margin-left: auto;
  }
  .pfoot {
    display: flex;
    gap: 16px;
    padding: 10px 18px;
    border-top: 1px solid var(--line);
    font-size: 11.5px;
    color: var(--fa);
    flex: none;
  }
</style>
