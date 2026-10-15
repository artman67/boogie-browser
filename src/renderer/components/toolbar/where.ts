// Where you are in the library: an icon, a name, and (for folders) the folder's color. The toolbar
// shows it, and so does the Library tab. Reads stores, so call it inside $derived.
import type { Component } from 'svelte';
import Folder from '@lucide/svelte/icons/folder';
import Images from '@lucide/svelte/icons/images';
import Inbox from '@lucide/svelte/icons/inbox';
import Shuffle from '@lucide/svelte/icons/shuffle';
import Sparkles from '@lucide/svelte/icons/sparkles';
import Tag from '@lucide/svelte/icons/tag';
import Tags from '@lucide/svelte/icons/tags';
import Trash2 from '@lucide/svelte/icons/trash-2';
import { library } from '../../lib/stores/library.svelte';
import { view } from '../../lib/stores/view.svelte';
import { FOLDER_COLORS } from '../../../shared/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Where = { name: string; icon: Component<any>; color?: string };

export function whereYouAre(): Where {
  const s = view.scope;
  switch (s.kind) {
    case 'all':
      return { name: 'All', icon: Images };
    case 'uncategorized':
      return { name: 'Uncategorized', icon: Inbox };
    case 'untagged':
      return { name: 'Untagged', icon: Tags };
    case 'trash':
      return { name: 'Trash', icon: Trash2 };
    case 'random':
      return { name: 'Random', icon: Shuffle };
    case 'folder': {
      const f = library.folder(s.id)?.node;
      return {
        name: f?.name ?? 'Folder',
        icon: Folder,
        color: f?.iconColor ? FOLDER_COLORS[f.iconColor] : undefined,
      };
    }
    case 'smartFolder': {
      const f = library.smartFolders.get(s.id);
      return {
        name: f?.name ?? 'Smart folder',
        icon: Sparkles,
        color: f?.iconColor ? FOLDER_COLORS[f.iconColor] : undefined,
      };
    }
    case 'tag':
      return { name: s.name, icon: Tag };
    case 'ids':
      return { name: 'Selected items', icon: Images };
  }
}
