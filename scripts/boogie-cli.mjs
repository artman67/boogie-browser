#!/usr/bin/env node
// `boogie`: Boogie Browser's MCP tools from the command line, for agents whose MCP connection is
// down (the app wasn't running when their session started). If the app isn't running, this starts
// it headless (no window, MCP server only) and waits for it. The tools themselves live in the app;
// this is only a client, so the command and the MCP server can never disagree.
//
//   boogie                          rules for agents + the tool list
//   boogie help <tool>              what a tool does and its arguments
//   boogie <tool> [key=value ...]   call a tool (or pass one JSON object: boogie <tool> '{"k":1}')
//   --as <name>                     the name the app shows for you (default: $BOOGIE_AGENT or boogie-cli)
//
// Env: BOOGIE_HOME (an isolated config, as for the app), BOOGIE_APP (the app binary to start;
// default ~/.local/opt/boogie-browser/boogie-browser). The installed `boogie` runs this file with
// the app's own Electron as Node, so no system Node is needed.
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const env = process.env;
const home = homedir();
const config = env.BOOGIE_HOME
  ? join(env.BOOGIE_HOME, 'config')
  : join(env.XDG_CONFIG_HOME || join(home, '.config'), 'boogie-browser');
const cache = env.BOOGIE_HOME
  ? join(env.BOOGIE_HOME, 'cache')
  : join(env.XDG_CACHE_HOME || join(home, '.cache'), 'boogie-browser');
const appBin = env.BOOGIE_APP || join(home, '.local/opt/boogie-browser/boogie-browser');
const MODERN = '2026-07-28';

function fail(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function settings() {
  try {
    return JSON.parse(readFileSync(join(config, 'settings.json'), 'utf8'));
  } catch {
    return {};
  }
}

const s = settings();
// Off in Settings is the user's hard stop for agents: never work around it.
if (s.mcpEnabled === false)
  fail("The agent server is turned off in Boogie Browser's Settings. Ask the user to turn it on.");
const url = `http://127.0.0.1:${s.mcpPort ?? 41597}/mcp`;

// ── arguments ──
let argv = process.argv.slice(2);
let agent = env.BOOGIE_AGENT || 'boogie-cli';
const asAt = argv.indexOf('--as');
if (asAt >= 0) {
  agent = argv[asAt + 1] ?? fail('--as needs a name.');
  argv = argv.toSpliced(asAt, 2);
}

// ── talking to the server ──
let nextId = 0;

async function post(method, params, extraHeaders = {}) {
  let token = '';
  try {
    token = readFileSync(join(config, 'api-token'), 'utf8').trim();
  } catch {
    /* the app creates it when it starts */
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'user-agent': 'boogie-cli/1',
      authorization: `Bearer ${token}`,
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params }),
  });
  const text = await res.text();
  if (res.status === 401)
    fail(
      `Boogie refused the token in ${join(config, 'api-token')}. Is another copy using this port?`,
    );
  if (res.status !== 200) fail(`Boogie's agent server answered ${res.status}: ${text}`);
  // Streamable HTTP may answer as an event stream: the last data line is the reply.
  const body = (res.headers.get('content-type') ?? '').includes('text/event-stream')
    ? text
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5))
        .at(-1)
    : text;
  const json = JSON.parse(body);
  if (json.error) fail(`${method} failed: ${json.error.message ?? JSON.stringify(json.error)}`);
  return json.result;
}

const refused = (e) => e?.cause?.code === 'ECONNREFUSED';

/** Make sure the server answers, starting the app headless if nothing is listening. */
async function ensureRunning() {
  try {
    await post('tools/list');
    return;
  } catch (e) {
    if (!refused(e)) throw e;
  }
  mkdirSync(cache, { recursive: true });
  const log = join(cache, 'headless.log');
  const childEnv = { ...env };
  // We may be running inside Electron-as-Node; the app must not inherit that.
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const args = ['--headless'];
  // No display at all (ssh, a service): Chromium still needs a platform to start.
  if (!env.WAYLAND_DISPLAY && !env.DISPLAY) args.push('--ozone-platform=headless');
  console.error('Starting Boogie Browser headless (no window)...');
  let exited = null;
  let logStart = 0;
  try {
    const out = openSync(log, 'a');
    logStart = statSync(log).size;
    const child = spawn(appBin, args, {
      detached: true,
      stdio: ['ignore', out, out],
      env: childEnv,
    });
    child.on('error', (e) => (exited = e.message));
    child.on('exit', (code) => (exited = `exit code ${code}`));
    child.unref();
  } catch (e) {
    fail(`Could not start ${appBin}: ${e.message}`);
  }
  const deadline = Date.now() + 90_000; // first start may index a big library
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    // An app that exits at once either failed, or handed off to a running copy whose server is off.
    if (exited) {
      const tail = readFileSync(log)
        .subarray(logStart)
        .toString()
        .trim()
        .split('\n')
        .slice(-5)
        .join('\n');
      fail(
        `Boogie Browser stopped (${exited}) without starting its agent server. Log: ${log}${tail ? `\n${tail}` : ''}`,
      );
    }
    try {
      await post('tools/list');
      return;
    } catch (e) {
      if (!refused(e)) throw e;
    }
  }
  fail(
    `Boogie Browser did not start its agent server at ${url} within 90 s. ` +
      `If the app is open, its port may be busy. Log: ${log}`,
  );
}

/** "key=value" pairs, typed by the tool's schema: strings stay strings, the rest is JSON. */
function parseArgs(parts, schema) {
  if (parts.length === 1 && parts[0].trim().startsWith('{')) return JSON.parse(parts[0]);
  const props = schema?.properties ?? {};
  const out = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 1) fail(`Arguments are key=value (got "${p}"). See: boogie help <tool>`);
    const key = p.slice(0, eq);
    const raw = p.slice(eq + 1);
    const type = props[key]?.type;
    if (type === 'string') out[key] = raw;
    else {
      try {
        out[key] = JSON.parse(raw);
      } catch {
        out[key] = raw;
      }
      // One value for a list (tags=sketch) means a list of one.
      if (type === 'array' && !Array.isArray(out[key])) out[key] = [raw];
    }
  }
  return out;
}

function describeArgs(schema) {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  return Object.entries(props).map(([k, v]) => {
    const type = v.type ?? (v.anyOf ? v.anyOf.map((a) => a.type).join('|') : v.enum ? 'enum' : '');
    const enums = v.enum ? ` (${v.enum.join(', ')})` : '';
    const desc = v.description ? `  ${v.description}` : '';
    return `  ${k}${required.has(k) ? '' : '?'}: ${type}${enums}${desc}`;
  });
}

const firstLine = (t = '') => t.split('\n')[0];

// ── commands ──
await ensureRunning();
const { tools } = await post('tools/list');
const [cmd, ...rest] = argv;

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  const name = rest[0];
  if (name) {
    const t = tools.find((t) => t.name === name) ?? fail(`No tool named "${name}".`);
    console.log(`${t.name}\n\n${t.description ?? ''}\n\nArguments (? = optional):`);
    console.log(describeArgs(t.inputSchema).join('\n') || '  (none)');
  } else {
    const init = await post('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: agent, version: '1' },
    }).catch(() => null);
    console.log(
      'Usage: boogie <tool> [key=value ...]   boogie help <tool>   (--as <your name>)\n' +
        'Values are JSON when they parse (limit=5, tags=\'["a","b"]\'), else text.\n',
    );
    if (init?.instructions) console.log(`${init.instructions}\n`);
    console.log('Tools:');
    for (const t of tools) console.log(`  ${t.name.padEnd(24)} ${firstLine(t.description)}`);
  }
  process.exit(0);
}

const tool = tools.find((t) => t.name === cmd) ?? fail(`No tool named "${cmd}". Run: boogie`);
const result = await post(
  'tools/call',
  {
    name: cmd,
    arguments: parseArgs(rest, tool.inputSchema),
    _meta: {
      'io.modelcontextprotocol/protocolVersion': MODERN,
      'io.modelcontextprotocol/clientInfo': { name: agent, version: '1' },
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  },
  { 'mcp-protocol-version': MODERN, 'mcp-method': 'tools/call', 'mcp-name': cmd },
);

for (const [i, c] of (result.content ?? []).entries()) {
  if (c.type === 'text') console.log(c.text);
  else if (c.type === 'image') {
    // Agents can't see bytes on stdout: save the picture and print where it is.
    const dir = join(cache, 'cli');
    mkdirSync(dir, { recursive: true });
    const ext = (c.mimeType ?? 'image/png').split('/')[1].replace('jpeg', 'jpg');
    const file = join(dir, `${cmd}-${Date.now()}-${i}.${ext}`);
    writeFileSync(file, Buffer.from(c.data, 'base64'));
    console.log(`[image saved: ${file}]`);
  }
}
process.exit(result.isError ? 1 : 0);
