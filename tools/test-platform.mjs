import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, win32 } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { managerCommands, detectHarness, installCommand, runCommand } from '../lib/host/harness-install.js';
import { findExecutable, executableSearchPaths, createDshService } from '../desktop/src/dsh-service.js';
import { focusBrowser } from '../desktop/src/browser-focus.js';
import { DEFAULTS } from '../desktop/src/settings.js';
import { markNavigationTitle } from '../lib/shared/client/desktop-mode.js';
import { createDesktopPresence } from '../lib/host/desktop-presence.js';

const token = '12345678-1234-1234-1234-123456789012';
const origin = 'http://127.0.0.1:3080';
const marker = `[Kujira:${token}]`;
const collect = async iterable => { const values = []; for await (const value of iterable) values.push(value); return values; };
function windowsFiles(files) {
  const canonical = value => win32.normalize(value).toLowerCase();
  const map = new Map(files.map(value => [canonical(value), value]));
  const resolve = async value => { if (!map.has(canonical(value))) throw Error('ENOENT'); return map.get(canonical(value)); };
  return { realpath: resolve, access: resolve, stat: async value => { await resolve(value); return { isFile: () => true }; } };
}

test('Windows discovers standalone pnpm.exe using Path, semicolons and Unicode paths', async () => {
  const file = 'C:\\Users\\青屿 User\\AppData\\Local\\pnpm\\pnpm.exe';
  const options = { platform: 'win32', home: 'C:\\Users\\青屿 User', execPath: 'C:\\Node\\node.exe',
    env: { Path: '.;"C:\\Users\\青屿 User\\AppData\\Local\\pnpm";D:\\other' }, fs: windowsFiles([file]) };
  assert.deepEqual(await collect(managerCommands('pnpm', options)), [{ file, args: [] }]);
});

test('Windows npm/pnpm cmd installations resolve to Node scripts without running cmd wrappers', async () => {
  const npm = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
  const pnpm = 'C:\\Users\\a b\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs';
  const options = { platform: 'win32', home: 'C:\\Users\\a b', execPath: 'C:\\Program Files\\nodejs\\node.exe',
    env: { APPDATA: 'C:\\Users\\a b\\AppData\\Roaming' }, fs: windowsFiles([npm, pnpm]) };
  for (const [name, script] of [['npm', npm], ['pnpm', pnpm]]) {
    const commands = await collect(managerCommands(name, options));
    assert.deepEqual(commands, [{ file: options.execPath, args: [script] }]);
    const command = installCommand({ supported: true, manager: name, command: commands[0] }, '0.1.6-alpha.2');
    assert.equal(command.file, options.execPath);
    assert(command.args.includes('@deepseek-ai/dsh@0.1.6-alpha.2'));
  }
});

test('Windows Corepack shims use the installed dist entry and deduplicate search paths', async () => {
  const file = 'D:\\Node\\node_modules\\corepack\\dist\\pnpm.js';
  const options = { platform: 'win32', home: 'C:\\Users\\a', execPath: 'D:\\Node\\node.exe',
    env: { Path: 'D:\\Node;d:\\node' }, fs: windowsFiles([file]) };
  assert.deepEqual(await collect(managerCommands('pnpm', options)), [{ file: options.execPath, args: [file] }]);
  assert.deepEqual(await collect(managerCommands('arbitrary', options)), []);
});

test('Windows missing managers and arbitrary bare cmd wrappers stay unsupported', async () => {
  const options = { platform: 'win32', home: 'C:\\Users\\a', execPath: 'C:\\Node\\node.exe',
    env: { Path: 'relative;C:\\Unknown' }, fs: windowsFiles(['C:\\Unknown\\pnpm.cmd']) };
  assert.deepEqual(await collect(managerCommands('pnpm', options)), []);
});

test('native package discovery skips a foreign global install and selects the running installation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kujira-platform-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const foreign = join(directory, 'other-global');
  const matching = join(directory, 'active-global');
  for (const root of [foreign, matching]) {
    const pkg = join(root, '@deepseek-ai', 'dsh');
    await mkdir(join(pkg, 'bin'), { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.6-alpha.2' }));
    await writeFile(join(pkg, 'bin', 'dsh.js'), '');
  }
  const calls = [];
  const options = { entry: join(matching, '@deepseek-ai', 'dsh', 'bin', 'dsh.js'), env: { CUSTOM: 'kept' },
    commands: async function* (name) { if (name === 'pnpm') for (const file of ['broken', 'foreign', 'matching']) yield { file, args: [] }; },
    run: async (command, { env }) => {
      calls.push(command.file);
      assert.equal(env.CUSTOM, 'kept'); assert.equal(env.COREPACK_ENABLE_PROJECT_SPEC, '0');
      if (command.file === 'broken') throw Error('not runnable');
      return command.file === 'foreign' ? foreign : matching;
    } };
  const found = await detectHarness(options);
  assert.equal(found.supported, true); assert.equal(found.command.file, 'matching');
  assert.deepEqual(calls, ['broken', 'foreign', 'matching']);
  const source = await detectHarness({ ...options, commands: async function* () {} });
  assert.equal(source.supported, false); assert.equal(source.current, '0.1.6-alpha.2');
});

test('native runner keeps argv paths with spaces and disables project-specific Corepack selection', async () => {
  const result = await runCommand({ file: process.execPath, args: ['-e',
    'process.stdout.write(JSON.stringify([process.argv[1],process.env.COREPACK_ENABLE_PROJECT_SPEC]))', '目录 with spaces & literal'] });
  assert.deepEqual(JSON.parse(result), ['目录 with spaces & literal', '0']);
});

test('an already cancelled update never starts a package manager', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runCommand({ file: 'npm', args: [] }, { signal: controller.signal,
    spawnProcess: () => assert.fail('cancelled update spawned') }), /update-cancelled/);
});

test('Windows cancellation falls back to killing its child if taskkill exits unsuccessfully', async () => {
  const controller = new AbortController(); const calls = []; let killed = 0;
  const child = Object.assign(new EventEmitter(), { pid: 1234, stdout: new EventEmitter(), stderr: new EventEmitter(),
    kill() { killed++; queueMicrotask(() => child.emit('close', 1)); } });
  const killer = Object.assign(new EventEmitter(), { kill() {} });
  const promise = runCommand({ file: 'C:\\pnpm.exe', args: [] }, { platform: 'win32', signal: controller.signal,
    spawnProcess: (file, args, options) => {
      calls.push({ file, args, options });
      if (calls.length === 1) return child;
      queueMicrotask(() => killer.emit('close', 1)); return killer;
    } });
  controller.abort(); await assert.rejects(promise, /update-cancelled/);
  assert.equal(killed, 1); assert.equal(calls[0].options.detached, false);
  assert.equal(calls[1].file, 'taskkill.exe'); assert.deepEqual(calls[1].args, ['/pid', '1234', '/T', '/F']);
});

test('DSH Windows resolution uses absolute platform paths and per-user install locations', async () => {
  const file = 'C:\\Users\\青屿\\AppData\\Local\\pnpm\\dsh.cmd';
  const options = { platform: 'win32', home: 'C:\\Users\\青屿',
    env: { Path: '.;relative;"D:\\tools"', LOCALAPPDATA: 'C:\\Users\\青屿\\AppData\\Local' }, fs: windowsFiles([file]) };
  assert.equal(await findExecutable('', options), file);
  assert.equal(await findExecutable(file, options), file);
  await assert.rejects(findExecutable('relative\\dsh.cmd', options), /absolute-path-required/);
  const paths = executableSearchPaths(options);
  assert(paths.includes('D:\\tools')); assert(paths.every(win32.isAbsolute));
  assert(!paths.includes('/opt/homebrew/bin'));
});

test('Windows detached start forwards one PATH key and keeps runtime dependencies discoverable', async () => {
  let probes = 0, spawned = 0;
  const env = { Path: 'C:\\Node;C:\\Windows\\System32', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' };
  const service = createDshService({ getSettings: () => DEFAULTS, platform: 'win32', env,
    openUrl: async () => {}, resolveExecutable: async (_, options) => { assert.equal(options.platform, 'win32'); return 'C:\\Users\\a\\AppData\\Local\\pnpm\\dsh.cmd'; },
    fetcher: async () => {
      if (!probes++) throw Object.assign(Error('offline'), { cause: { code: 'ECONNREFUSED' } });
      return Response.json({ product: 'dsh-kujira', protocol: 1, instance: 'test' });
    }, spawnProcess: (_, args, options) => {
      spawned++; assert.equal(options.shell, false); assert.equal(options.detached, true); assert.equal(options.windowsHide, true);
      assert.equal(options.windowsVerbatimArguments, true); assert(args.includes('/c'));
      assert.deepEqual(Object.keys(options.env).filter(key => key.toLowerCase() === 'path'), ['PATH']);
      assert(options.env.PATH.includes(';C:\\Node;')); assert(!options.env.PATH.includes('/opt/homebrew'));
      return { once() { return this; }, unref() {} };
    } });
  await Promise.all([service.ensureRunning(), service.ensureRunning()]); assert.equal(spawned, 1);
});

test('Windows activation requires the acknowledged marker and verified foreground result', async () => {
  const calls = [];
  const run = async (...args) => { calls.push(args); return { stdout: 'matched\r\n' }; };
  assert.equal(await focusBrowser('chrome', 'win32', run, origin, { focusToken: token }), true);
  assert(calls[0][1].at(-1).includes('EnumWindows')); assert(calls[0][1].at(-1).includes('GetForegroundWindow() -eq $handle'));
  assert(calls[0][1].at(-1).includes(marker));
  for (const stdout of ['', 'missing', 'blocked'])
    assert.equal(await focusBrowser('chrome', 'win32', async () => ({ stdout }), origin, { focusToken: token }), false);
  assert.equal(await focusBrowser('chrome', 'win32', () => assert.fail('no token'), origin), false);
  assert.equal(await focusBrowser('chrome', 'win32', () => assert.fail('invalid token'), origin, { focusToken: "'; whoami" }), false);
});

test('macOS selects the acknowledged tab within the matching origin', async () => {
  let args;
  assert.equal(await focusBrowser('chrome', 'darwin', async (...values) => { args = values; return { stdout: 'matched' }; }, origin, { focusToken: token }), true);
  assert.equal(args[1].at(-1), marker); assert(args[1][3].includes('title.indexOf(argv[3])===0'));
  assert.equal(await focusBrowser('firefox', 'darwin', () => assert.fail('cannot confirm tab'), origin, { focusToken: token }), false);
});

test('X11 selects the marked browser window and checks the actual active window', async () => {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, args]);
    if (args[0] === '-lx') return { stdout: `0x00aa0011 0 google-chrome.Google-chrome host other page\n0x00aa0022 0 google-chrome.Google-chrome host ${marker} DSH` };
    return { stdout: file === 'xprop' ? '_NET_ACTIVE_WINDOW(WINDOW): window id # 0xaa0022' : '' };
  };
  assert.equal(await focusBrowser('chrome', 'linux', run, origin, { focusToken: token, env: { DISPLAY: ':0' } }), true);
  assert.deepEqual(calls[1], ['wmctrl', ['-ia', '0x00aa0022']]);
});

test('Wayland, missing tools, ambiguous windows and rejected X11 focus do not claim success', async () => {
  const options = { focusToken: token, env: { DISPLAY: ':0' }, wait: async () => {} };
  assert.equal(await focusBrowser('chrome', 'linux', () => assert.fail('native Wayland'), origin,
    { ...options, env: { WAYLAND_DISPLAY: 'wayland-0' } }), false);
  assert.equal(await focusBrowser('chrome', 'linux', async () => { throw Error('missing wmctrl'); }, origin, options), false);
  const line = id => `${id} 0 google-chrome.Google-chrome host ${marker} DSH`;
  assert.equal(await focusBrowser('chrome', 'linux', async (_, args) => {
    assert.equal(args[0], '-lx'); return { stdout: line('0xaa11') + '\n' + line('0xaa22') };
  }, origin, options), false);
  assert.equal(await focusBrowser('chrome', 'linux', async (file, args) => ({ stdout:
    args[0] === '-lx' ? line('0xaa22') : file === 'xprop' ? '_NET_ACTIVE_WINDOW(WINDOW): window id # 0xaa11' : '' }), origin, options), false);
});

test('tab marker follows host title updates and cleanup restores the latest title', () => {
  const doc = { title: 'Original DSH', head: {} }; let observed, expires, disconnected = 0;
  const clear = markNavigationTitle(token, { doc,
    Observer: class { constructor(callback) { observed = callback; } observe() {} disconnect() { disconnected++; } },
    schedule: fn => { expires = fn; return 1; }, cancel: () => {} });
  assert.equal(doc.title, marker + ' Original DSH');
  doc.title = 'New session DSH'; observed(); assert.equal(doc.title, marker + ' New session DSH');
  expires(); assert.equal(doc.title, 'New session DSH');
  clear(); assert.equal(doc.title, 'New session DSH'); assert.equal(disconnected, 2);
});

test('focus acknowledgement is bound to the assigned tab and expires with the command', () => {
  let clock = 0; const presence = createDesktopPresence({ now: () => clock });
  const client = 'browser-tab-12345678';
  presence.update({ action: 'browser-poll', client, browser: 'chrome' });
  const first = presence.update({ action: 'navigate', target: { kind: 'web' } });
  presence.update({ action: 'navigation-ack', client, id: first.navigationId, success: true, focusToken: 'foreign', focused: false });
  assert.equal(presence.update({ action: 'navigation-status', id: first.navigationId }).result.focusToken, null);
  assert.equal(presence.update({ action: 'navigation-ack', client, id: first.navigationId, success: false }), null);
  const second = presence.update({ action: 'navigate', target: { kind: 'web' } });
  presence.update({ action: 'navigation-ack', client, id: second.navigationId, success: true, focusToken: second.navigationId });
  assert.equal(presence.update({ action: 'navigation-status', id: second.navigationId }).result.focusToken, second.navigationId);
  presence.update({ action: 'navigation-finish', id: second.navigationId });
  assert.equal(presence.update({ action: 'browser-poll', client }).focusReleased, second.navigationId);
  const third = presence.update({ action: 'navigate', target: { kind: 'web' } }); clock = 15001;
  assert.equal(presence.update({ action: 'navigation-ack', client, id: third.navigationId, success: true }), null);
});
