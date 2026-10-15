// Item tabs. Every item opened in the detail view gets a tab in the row along the top of the
// window, after the Library tab (the grid). The tabs behind the one on screen stay alive, so a book
// keeps its page and a painting its zoom.
//
// This store also holds what the viewer shows: `ui.viewer` reads and writes it here. So every way
// of opening, stepping and closing the viewer keeps the tabs right without knowing about them:
//   detail mode, no tab on screen       -> a new tab (or the tab already showing that item)
//   detail mode, a tab on screen        -> that tab moves along (the arrow keys)
//   nothing, a tab on screen            -> that tab closes and the library shows (Esc, Back)
//   another mode (slideshow, compare)   -> on top of the tab; closing it goes back to the tab
import { viewer as look } from '../../components/viewer/state.svelte';
import { readJSON, writeJSON } from '../storage';

export type ViewerMode = 'detail' | 'quicklook' | 'compare' | 'present';
/** Raw: `ids` can be the grid's whole 85k-item list. Replace it whole, never mutate it. */
export interface ViewerState {
  mode: ViewerMode;
  ids: string[];
  index: number;
}

/** The view-only toggles each tab keeps for itself. */
interface Look {
  flip: boolean;
  gray: boolean;
  rotate: number;
}

export interface Tab {
  key: string;
  /** The list the arrow keys step through (the grid it was opened from). */
  ids: string[];
  index: number;
  look: Look;
}

const PLAIN: Look = { flip: false, gray: false, rotate: 0 };
/** Saved for next time: this many ids on each side of the item (the list can be the whole library). */
const SAVED_SIDE = 1000;
const MAX_CLOSED = 20;

export const tabItem = (t: Tab): string => t.ids[t.index];

/** The part of a long list around `index`: at most `side` ids on each side of it. */
export function around(
  ids: readonly string[],
  index: number,
  side: number,
): { ids: string[]; index: number } {
  const from = Math.max(0, index - side);
  return { ids: ids.slice(from, index + side + 1), index: index - from };
}

let lastKey = 0;
const newKey = () => `t${++lastKey}`;

class TabsStore {
  list = $state.raw<Tab[]>([]);
  /** The item tab on screen, or null for the library. */
  active = $state<string | null>(null);
  /** Tabs that have been on screen. Only these keep a live view: restored tabs load when opened. */
  seen = $state.raw(new Set<string>());
  /** Items open in a tab (the dots on the grid's tiles). */
  openIds = $derived(new Set(this.list.map(tabItem)));

  #viewer = $state.raw<ViewerState | null>(null);
  #closed: Tab[] = [];
  /** Where the list is saved; null in a pop-out window, which never saves. */
  #saveKey: string | null = null;
  #saveTimer: ReturnType<typeof setTimeout> | undefined;

  get viewer(): ViewerState | null {
    return this.#viewer;
  }

  set viewer(v: ViewerState | null) {
    const on = this.active;
    if (v?.mode === 'detail') {
      if (!on) {
        this.open(v.ids, v.index);
        return;
      }
      this.#update(on, { ids: v.ids, index: v.index });
    } else if (!v && on) {
      // Esc or Back in the detail view closes the tab. Closing a slideshow (or compare) that was
      // started from a tab goes back to that tab.
      if (this.#viewer?.mode === 'detail') {
        this.#forget(on);
        this.active = null;
      } else {
        const t = this.get(on);
        if (t) v = { mode: 'detail', ids: t.ids, index: t.index };
      }
    }
    this.#viewer = v;
  }

  get(key: string): Tab | undefined {
    return this.list.find((t) => t.key === key);
  }

  get canReopen(): boolean {
    return this.#closed.length > 0;
  }

  /**
   * A tab for `ids[index]`, on screen unless `show` is false (middle-click opens it behind). An
   * item that already has a tab goes to that tab, which takes on the new list.
   */
  open(ids: string[], index: number, show = true, lookOf: Look = PLAIN): void {
    const id = ids[index];
    if (!id) return;
    const had = this.list.find((t) => tabItem(t) === id);
    const key = had?.key ?? newKey();
    if (had) this.#update(key, { ids, index });
    else this.list = [...this.list, { key, ids, index, look: lookOf }];
    this.#save();
    if (show) this.show(key);
  }

  /** Put a tab on screen; null shows the library. */
  show(key: string | null): void {
    const next = key ? this.get(key) : undefined;
    if (key && !next) return;
    const from = this.active;
    if (from === key && (next ? this.#viewer?.mode === 'detail' : !this.#viewer)) return;
    if (from && this.#viewer?.mode === 'detail')
      this.#update(from, { look: { flip: look.flip, gray: look.gray, rotate: look.rotate } });
    this.active = key;
    if (!next) return void (this.#viewer = null);
    if (!this.seen.has(next.key)) this.seen = new Set(this.seen).add(next.key);
    look.flip = next.look.flip;
    look.gray = next.look.gray;
    look.rotate = next.look.rotate;
    this.#viewer = { mode: 'detail', ids: next.ids, index: next.index };
  }

  /** Ctrl+Tab and Ctrl+Shift+Tab: the next or previous tab, the library included, round and round. */
  cycle(delta: 1 | -1): void {
    const keys = [null, ...this.list.map((t) => t.key)];
    const at = keys.indexOf(this.active);
    this.show(keys[(at + delta + keys.length) % keys.length]);
  }

  /** Close a tab. If it was on screen, the one to its right shows (else to its left, else the library). */
  close(key: string, remember = true): void {
    const at = this.list.findIndex((t) => t.key === key);
    if (at < 0) return;
    if (this.active === key) {
      const near = this.list[at + 1] ?? this.list[at - 1];
      this.show(near?.key ?? null);
    }
    this.#forget(key, remember);
  }

  closeOthers(key: string): void {
    for (const t of this.list) if (t.key !== key) this.close(t.key);
  }

  /** Ctrl+Shift+T: the last closed tab comes back (on screen). */
  reopen(): void {
    const t = this.#closed.pop();
    if (t) this.open(t.ids, t.index, true, t.look);
  }

  /** Drag along the row: the tab moves to `to` (its place among the item tabs). */
  move(key: string, to: number): void {
    const from = this.list.findIndex((t) => t.key === key);
    if (from < 0 || from === to) return;
    const list = [...this.list];
    list.splice(Math.max(0, Math.min(to, list.length - 1)), 0, ...list.splice(from, 1));
    this.list = list;
    this.#save();
  }

  /**
   * Another library is open (or the app started): its own tabs, from last time, with the library
   * on screen. `save` is false in a pop-out window, which only ever has its own one tab.
   */
  load(libraryId: string | null, save = true): void {
    this.flush();
    this.#closed = [];
    this.active = null;
    this.#viewer = null;
    this.seen = new Set();
    this.#saveKey = libraryId && save ? `tabs.${libraryId}` : null;
    const saved = this.#saveKey ? readJSON<unknown>(this.#saveKey, []) : [];
    this.list = (Array.isArray(saved) ? saved : []).flatMap((s): Tab[] => {
      const ok =
        Array.isArray(s?.ids) &&
        s.ids.every((x: unknown) => typeof x === 'string') &&
        Number.isInteger(s.index) &&
        s.index >= 0 &&
        s.index < s.ids.length;
      return ok ? [{ key: newKey(), ids: s.ids, index: s.index, look: PLAIN }] : [];
    });
  }

  #update(key: string, patch: Partial<Omit<Tab, 'key'>>): void {
    this.list = this.list.map((t) => (t.key === key ? { ...t, ...patch } : t));
    this.#save();
  }

  #forget(key: string, remember = true): void {
    const t = this.get(key);
    if (!t) return;
    if (remember) this.#closed = [...this.#closed, t].slice(-MAX_CLOSED);
    this.list = this.list.filter((x) => x.key !== key);
    if (this.seen.has(key)) this.seen = new Set([...this.seen].filter((k) => k !== key));
    this.#save();
  }

  // Saved a moment after the last change: the arrow keys change the list on every press.
  #save(): void {
    if (!this.#saveKey) return;
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.flush(), 500);
  }

  /** Save now (the window is closing). */
  flush(): void {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = undefined;
    if (this.#saveKey)
      writeJSON(
        this.#saveKey,
        this.list.map((t) => around(t.ids, t.index, SAVED_SIDE)),
      );
  }
}

export const tabs = new TabsStore();
