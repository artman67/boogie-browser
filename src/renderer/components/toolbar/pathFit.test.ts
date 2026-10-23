import { describe, expect, it } from 'vitest';
import { fitPath, type PathWidths } from './pathFit';

// library 100 (badge 30), four ancestors of 80, current 120, "…" 30. Everything: 540.
const w: PathWidths = {
  library: 100,
  libraryBadge: 30,
  ancestors: [80, 80, 80, 80],
  current: 120,
  fold: 30,
};

describe('fitPath', () => {
  it('shows everything when it fits', () => {
    expect(fitPath(w, 540)).toEqual({ folded: 0, libraryName: true });
  });

  it('drops the library name before folding any folder', () => {
    expect(fitPath(w, 470)).toEqual({ folded: 0, libraryName: false });
  });

  it('folds ancestors from the top, keeping as many near the current folder as fit', () => {
    // badge 30 + "…" 30 + two ancestors 160 + current 120 = 340
    expect(fitPath(w, 345)).toEqual({ folded: 2, libraryName: false });
  });

  it('folds everything when only the current folder fits, and never hides it', () => {
    expect(fitPath(w, 100)).toEqual({ folded: 4, libraryName: false });
    expect(fitPath({ ...w, ancestors: [] }, 100)).toEqual({ folded: 0, libraryName: false });
  });
});
