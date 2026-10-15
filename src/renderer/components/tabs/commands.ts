// The tab keys. Main window only (App registers them). They work over the detail view too, but not
// over the slideshow or Triage, which keep the keyboard to themselves.
import { registerCommands, type CommandContext } from '../../lib/commands.svelte';
import { contextMenu } from '../../lib/contextMenu.svelte';
import { tabs } from '../../lib/stores/tabs.svelte';
import { ui } from '../../lib/stores/ui.svelte';
import { view } from '../../lib/stores/view.svelte';
import { popOut } from '../viewer/actions';

const G = 'Tabs';
const free = (c: CommandContext) =>
  c.region !== 'overlay' && !ui.dialog && !ui.picker && !contextMenu.open;
const onTab = (c: CommandContext) => free(c) && !!tabs.active;

export function registerTabCommands(): () => void {
  return registerCommands([
    {
      id: 'tabs.next',
      title: 'Next tab',
      group: G,
      keys: ['Ctrl+Tab'],
      when: (c) => free(c) && tabs.list.length > 0,
      run: () => tabs.cycle(1),
    },
    {
      id: 'tabs.previous',
      title: 'Previous tab',
      group: G,
      keys: ['Ctrl+Shift+Tab'],
      when: (c) => free(c) && tabs.list.length > 0,
      run: () => tabs.cycle(-1),
    },
    {
      id: 'tabs.library',
      title: 'Show the library',
      group: G,
      keys: ['Ctrl+1'],
      when: onTab,
      run: () => tabs.show(null),
    },
    {
      // A tab holds one item, so a "new tab" is the library's All page, to pick the next one from.
      id: 'tabs.new',
      title: 'New tab (the library, All)',
      group: G,
      keys: ['Ctrl+T'],
      when: free,
      run: () => (tabs.show(null), view.setScope({ kind: 'all' })),
    },
    // Ctrl+2 to Ctrl+8: the item tabs in row order, like a web browser. Ctrl+9 stays "zoom to fit".
    ...[2, 3, 4, 5, 6, 7, 8].map((n) => ({
      id: `tabs.go${n}`,
      title: `Go to tab ${n}`,
      group: G,
      keys: [`Ctrl+${n}`],
      hidden: true,
      when: (c: CommandContext) => free(c) && tabs.list.length >= n - 1,
      run: () => tabs.show(tabs.list[n - 2].key),
    })),
    {
      id: 'tabs.close',
      title: 'Close tab',
      group: G,
      keys: ['Ctrl+W'],
      when: onTab,
      run: () => tabs.active && tabs.close(tabs.active),
    },
    {
      id: 'tabs.reopen',
      title: 'Reopen closed tab',
      group: G,
      keys: ['Ctrl+Shift+T'],
      when: (c) => free(c) && tabs.canReopen,
      run: () => tabs.reopen(),
    },
    {
      id: 'tabs.popOut',
      title: 'Pop out into its own window',
      group: G,
      when: onTab,
      run: () => tabs.active && popOut(tabs.active),
    },
  ]);
}
