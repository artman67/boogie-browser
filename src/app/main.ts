// Boogie Browser's Electron main process: starts the core, serves boogie://, opens the window,
// runs the local servers, and shuts everything down cleanly (flushing mtime.json) on quit.
// `--headless` skips the window and runs only the MCP server, so agents can work without the user
// opening the app (the `boogie` command starts it this way). Opening the app later shows the window
// in that same process, and a headless app nobody uses quits by itself.
import { app, dialog, Menu, protocol, session, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { CoreHost } from '../core/contracts';
import { BOOGIE_SCHEME } from '../shared/api';
import { createAppMethods } from './appApi';
import { appPaths, openHost, serverStarters } from './core';
import { createDispatcher } from './dispatch';
import { ExportJobs } from './exporter';
import { registerIpc } from './ipc';
import { eagleUrlsFromArgv, revealFromEagleUrl, type RevealTarget } from './links';
import { createProtocolHandler } from './protocol';
import { Servers } from './servers';
import { Windows } from './windows';

app.setName('Boogie Browser');
// On Linux the window class (X11 WM_CLASS, Wayland app_id) comes from the desktop file name. Pin it
// so window rules and the launcher entry (boogie-browser.desktop, StartupWMClass=boogie-browser) match.
app.setDesktopName('boogie-browser.desktop');
const paths = appPaths();
// Keep Chromium's own files with the app's config, so BOOGIE_HOME fully isolates a test run
// (and its single-instance lock) from the real app.
app.setPath('userData', join(paths.config, 'electron'));
// No menu bar: the app draws its own header, the page handles its keys, and windows.ts adds the
// few window-level ones a menu would give (Ctrl+Q, F11).
Menu.setApplicationMenu(null);

// The renderer loads thumbnails and originals through boogie://. Must be registered before ready.
// corsEnabled (with the allow-origin header in protocol.ts) lets our own pages fetch() and read pixels from it.
protocol.registerSchemesAsPrivileged([
  {
    scheme: BOOGIE_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: false,
    },
  },
]);

const headless = process.argv.includes('--headless');
/** A headless app with no window and no agent calls for this long quits. */
const IDLE_MS = 30 * 60_000;
let lastAgentCall = Date.now();
/** Becomes true when the app is opened normally, possibly while a headless one is still starting. */
let wantWindow = !headless;

let windows: Windows | null = null;
let host: CoreHost | null = null;
let servers: Servers | null = null;
let stopIpc: (() => void) | null = null;

// Links can arrive before the window can act on them (a first launch from an eagle:// link):
// they wait until the page has loaded and a library is open.
let revealReady = false;
let pendingReveal: RevealTarget | null = null;

/** Bring an item, folder or smart folder into view in the main window (the renderer does the rest). */
function reveal(target: RevealTarget): void {
  if (!revealReady) {
    pendingReveal = target;
    return;
  }
  windows?.focusMain();
  windows?.broadcast('reveal', target);
}

/** eagle://item|folder|smart-folder/<id> links, from the command line or a second instance. */
function handleEagleLinks(argv: readonly string[]): void {
  for (const url of eagleUrlsFromArgv(argv)) {
    console.log('[eagle://] link received:', url);
    const target = revealFromEagleUrl(url);
    if (target) reveal(target);
  }
}

/** The renderer handles `reveal` once its page is up and it shows a library. */
function armReveal(core: CoreHost, win: BrowserWindow): void {
  let armed = false;
  const ready = () => {
    if (armed) return;
    armed = true;
    off();
    // The page gets the `library` event first; give it a moment to show that library.
    setTimeout(() => {
      revealReady = true;
      if (pendingReveal) reveal(pendingReveal);
      pendingReveal = null;
    }, 500);
  };
  const off = core.on('library', () => {
    if (!win.webContents.isLoading()) ready();
  });
  win.webContents.once('did-finish-load', () => {
    void core.api.getLibraryState().then((st) => st && ready());
  });
}

if (!app.requestSingleInstanceLock()) {
  // Another Boogie Browser is already running: it gets focus (see second-instance below).
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    // Another `--headless` launch only wants the core running, which it is. Anything else is the
    // user opening the app: show (or create) the window.
    if (!argv.includes('--headless')) {
      wantWindow = true;
      openMain();
    }
    handleEagleLinks(argv);
  });
  // macOS delivers links this way instead; harmless elsewhere.
  app.on('open-url', (e, url) => {
    e.preventDefault();
    handleEagleLinks([url]);
  });

  app.on('window-all-closed', () => app.quit());

  // Flush before exiting: the core writes mtime.json a moment after each item write, and the partner's
  // Eagle ignores changes that are not in it. Capped at 5 s so a stuck close can't hang the quit.
  let shuttingDown = false;
  app.on('before-quit', (e) => {
    if (shuttingDown || !host) return;
    shuttingDown = true;
    e.preventDefault();
    windows?.saveStateNow();
    stopIpc?.();
    const closing = (async () => {
      await servers?.close();
      await host?.close();
    })().catch((err) => console.warn('[quit] cleanup failed:', err));
    const cap = new Promise((resolve) => setTimeout(resolve, 5000).unref());
    void Promise.race([closing, cap]).finally(() => app.quit());
  });
  // A plain `kill` should also flush.
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => app.quit());

  process.on('uncaughtException', (err) => console.error('[main] uncaught exception:', err));
  process.on('unhandledRejection', (err) => console.error('[main] unhandled rejection:', err));

  void app.whenReady().then(start);
}

async function start(): Promise<void> {
  // The window only ever needs to write to the clipboard (text) and go full screen.
  const allowed = (permission: string) =>
    permission === 'clipboard-sanitized-write' || permission === 'fullscreen';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) =>
    done(allowed(permission)),
  );
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed(permission));

  try {
    host = await openHost(paths);
  } catch (e) {
    console.error('[main] the core failed to start:', e);
    if (!headless)
      dialog.showErrorBox(
        'Boogie Browser could not start',
        e instanceof Error ? e.message : String(e),
      );
    app.exit(1);
    return;
  }
  const core = host;

  protocol.handle(BOOGIE_SCHEME, createProtocolHandler(core));

  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png');
  const win = new Windows({
    configDir: paths.config,
    preload: join(import.meta.dirname, '../preload/index.cjs'),
    rendererDir: join(import.meta.dirname, '../renderer'),
    devUrl: process.env.ELECTRON_RENDERER_URL,
    iconPath,
    devtools: !app.isPackaged || process.env.BOOGIE_DEVTOOLS === '1',
    quit: () => app.quit(),
  });
  windows = win;

  const exports = new ExportJobs(core, (job) => win.broadcast('job', job));
  // "Copy link" pages (http://localhost:41595/item?id=...) opened in a browser reveal the item here.
  const srv = new Servers(core, serverStarters, {
    onOpen: (t) => reveal({ kind: t.kind === 'smart-folder' ? 'smartFolder' : t.kind, id: t.id }),
    onMcpRequest: () => (lastAgentCall = Date.now()),
  });
  servers = srv;
  const dispatch = createDispatcher({
    api: core.api,
    app: createAppMethods({ host: core, windows: win, exports, iconPath }),
    exports,
    onSettingsChanged: () =>
      void srv.sync().catch((e) => console.warn('[servers] sync failed:', e)),
  });
  stopIpc = registerIpc({ host: core, windows: win, dispatch });

  if (wantWindow) openMain();
  else {
    srv.mcpOnly = true;
    quitWhenIdle(core);
    console.log('[main] running headless: MCP server only, no window');
  }
  handleEagleLinks(process.argv);

  // Servers start after the window is up so a busy port never delays the UI.
  void srv.sync().catch((e) => console.warn('[servers] start failed:', e));
}

/** Show the main window, creating it if needed (a headless app gets its first one here). */
function openMain(): void {
  if (!windows || !host || !servers) return; // still starting: start() opens it (wantWindow)
  if (windows.main) return windows.focusMain();
  // Closing the main window quits the app, even with a reference window still floating.
  const main = windows.createMain();
  main.on('closed', () => app.quit());
  armReveal(host, main);
  if (servers.mcpOnly) {
    servers.mcpOnly = false;
    void servers.sync().catch((e) => console.warn('[servers] start failed:', e));
  }
}

/** A headless app quits once no window was opened and no agent has called for IDLE_MS, unless a job runs. */
function quitWhenIdle(core: CoreHost): void {
  const timer = setInterval(() => {
    if (windows?.main) return clearInterval(timer);
    if (Date.now() - lastAgentCall < IDLE_MS) return;
    void core.api
      .listJobs()
      .then((jobs) => {
        if (jobs.some((j) => j.state === 'running')) return;
        console.log('[main] headless and idle: quitting');
        app.quit();
      })
      .catch(() => app.quit());
  }, 60_000);
}
