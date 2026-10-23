// A single right-click menu for the whole app, rendered by lib/ui/ContextMenu.svelte.
//   openContextMenu(e, [{ label: 'Rename', keys: 'F2', run: () => ... }, { separator: true }, ...])
//   openMenuBelow(button, items)   // a menu that hangs from a button
export interface MenuItem {
  label?: string;
  keys?: string; // shown faint on the right: a shortcut ('F2') or a count
  icon?: string; // lucide icon name (optional)
  danger?: boolean;
  disabled?: boolean;
  /** Tooltip, e.g. why the item is disabled ("Read-only: ..."). */
  title?: string;
  /** A CSS color drawn as a small dot before the label (folder colors). */
  swatch?: string;
  separator?: boolean;
  checked?: boolean;
  /** Steps to indent the label (a list of nested folders). */
  indent?: number;
  submenu?: MenuItem[];
  run?: () => unknown;
}

class ContextMenuStore {
  /** maxHeight: past it the menu scrolls (menus without submenus only). */
  open = $state<{ x: number; y: number; items: MenuItem[]; maxHeight?: number } | null>(null);
}

export const contextMenu = new ContextMenuStore();

export function openContextMenu(e: MouseEvent, items: MenuItem[]): void {
  e.preventDefault();
  e.stopPropagation();
  openContextMenuAt(e.clientX, e.clientY, items);
}

/** Open at a point in the window (the menu keeps itself on screen). */
export function openContextMenuAt(
  x: number,
  y: number,
  items: MenuItem[],
  maxHeight?: number,
): void {
  contextMenu.open = { x, y, items, maxHeight };
}

/**
 * Open just under an element, left-aligned with it (toolbar and header buttons). A long list
 * stays under its button and scrolls in the room below, when there is a fair amount of it.
 */
export function openMenuBelow(el: Element | null, items: MenuItem[]): void {
  const r = el?.getBoundingClientRect();
  const y = r ? r.bottom + 4 : 56;
  const below = innerHeight - y - 8;
  openContextMenuAt(r ? r.left : 200, y, items, below >= 240 ? below : undefined);
}

export function closeContextMenu(): void {
  contextMenu.open = null;
}
