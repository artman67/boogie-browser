// How much of the path bar fits. Widths are measured in the DOM by PathBar; this only decides.

export interface PathWidths {
  /** The library crumb with its name, and with its badge only. */
  library: number;
  libraryBadge: number;
  /** The folders above the current one, top level first. */
  ancestors: number[];
  current: number;
  /** The "…" button that stands in for folded folders. */
  fold: number;
}

export interface PathFit {
  /** How many ancestors, counted from the top, fold into "…". */
  folded: number;
  /** Whether the library crumb keeps its name (else just its badge). */
  libraryName: boolean;
}

/**
 * Give up room in this order: the library's name, then ancestors from the top down. The library
 * badge and the current folder always stay; when even that doesn't fit, the current folder's name
 * is the one that gets cut (by CSS).
 */
export function fitPath(w: PathWidths, avail: number): PathFit {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const ancestors = sum(w.ancestors);
  if (w.library + ancestors + w.current <= avail) return { folded: 0, libraryName: true };
  let kept = ancestors;
  for (let folded = 0; folded <= w.ancestors.length; folded++) {
    if (folded > 0) kept -= w.ancestors[folded - 1];
    const fold = folded > 0 ? w.fold : 0;
    if (w.libraryBadge + fold + kept + w.current <= avail) return { folded, libraryName: false };
  }
  return { folded: w.ancestors.length, libraryName: false };
}
