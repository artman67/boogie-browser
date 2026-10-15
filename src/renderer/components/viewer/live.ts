// Tabs keep their views alive behind the one on screen. A hidden one must not answer the keys
// (zoom, Space, the seek keys) or keep playing, so its stages and players stand down while it is
// hidden. Views outside a tab (quick look, compare, the slideshow) are always live.
import { getContext, setContext } from 'svelte';

const KEY = Symbol('viewer-live');

/** Call during component setup: the views inside are live while `get()` is true. */
export function setLive(get: () => boolean): void {
  setContext(KEY, get);
}

/** Call during component setup. */
export function isLive(): () => boolean {
  return getContext<(() => boolean) | undefined>(KEY) ?? (() => true);
}
