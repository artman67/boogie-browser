<script lang="ts" module>
  // The sidebar's width: drag its right edge, double-click the edge for the default. Saved in
  // localStorage like the open sections. It drives --sidebar-w on the root, which the window's
  // grid (App.svelte) sizes the sidebar column from.
  import { readJSON, writeJSON } from '../../lib/storage';

  const KEY = 'sidebarWidth';
  const DEFAULT = 248;
  const clamp = (w: number) => Math.round(Math.min(520, Math.max(200, w)));
  const apply = (w: number) => document.documentElement.style.setProperty('--sidebar-w', `${w}px`);

  const saved = readJSON<unknown>(KEY, DEFAULT);
  let width = typeof saved === 'number' && Number.isFinite(saved) ? clamp(saved) : DEFAULT;
  apply(width);
</script>

<script lang="ts">
  let drag: { x: number; w: number } | null = null;
  let frame = 0;

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { x: e.clientX, w: width };
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    width = clamp(drag.w + e.clientX - drag.x);
    // The grid relays out on every width change; once a frame is plenty.
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => apply(width));
  }
  function up() {
    if (!drag) return;
    drag = null;
    apply(width);
    writeJSON(KEY, width);
  }
  function reset() {
    width = DEFAULT;
    apply(width);
    writeJSON(KEY, width);
  }
</script>

<!-- Pointer only: a mouse affordance, like the window's own edges. -->
<div
  class="sb-resize"
  aria-hidden="true"
  title="Drag to resize. Double-click to reset."
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  ondblclick={reset}
></div>

<style>
  .sb-resize {
    position: absolute;
    top: 0;
    bottom: 0;
    right: -3px;
    width: 6px;
    z-index: 5;
    cursor: col-resize;
  }
  .sb-resize:hover,
  .sb-resize:active {
    background: linear-gradient(90deg, transparent 2px, var(--bl) 2px 4px, transparent 4px);
  }
</style>
