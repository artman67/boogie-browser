// "Focus on this folder": the folder tree shows one branch. Kept per library for this session
// only (on purpose: a restart should never open on a tree with most folders missing).
class TreeFocus {
  private byLibrary = $state<Record<string, string>>({});

  get(libraryId: string): string | null {
    return this.byLibrary[libraryId] ?? null;
  }

  set(libraryId: string, folderId: string | null): void {
    if (folderId) this.byLibrary[libraryId] = folderId;
    else delete this.byLibrary[libraryId];
  }
}

export const treeFocus = new TreeFocus();
