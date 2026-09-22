import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { readLocalState, writeLocalState, captureLocalState, restoreLocalState } from '../lib/shared/client/utilities.js';
import { restoreBrowserHandoff } from '../lib/shared/client/desktop-mode.js';
import { createSettings } from '../desktop/src/settings.js';
import { connectPreferencePersistence } from '../desktop/ui/preference-persistence.js';
import { createPreferenceFlush, savePreferenceSnapshot } from '../desktop/src/preference-lifecycle.js';
import { createDesktopPresence } from '../lib/host/desktop-presence.js';
import { probeDsh } from '../desktop/src/dsh-service.js';
import { createWindowController } from '../desktop/src/window-controller.js';

const SETTINGS = 'dsh-kujira:settings', GROWTH = 'dsh-kujira:growth', POSITION = 'dsh-kujira:position';
function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
const snapshot = (size, stamp) => ({ appearance: { size, locale: 'ko-KR', displayCurrency: 'USD', menuSize: 42 },
  city: 'Shanghai', __growth: { bond: 99, unlocked: { idle: true } }, __position: { x: 30, y: 40 }, __updatedAt: stamp });
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'kujira-persist-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
function bridgeOptions(local, backup, overrides = {}) {
  let incoming, flush;
  const events = new EventTarget(), doc = new EventTarget(), writes = [];
  const api = {
    readPreferences: async () => backup,
    savePreferences: async value => writes.push(structuredClone(value)),
    onPreferences: fn => { incoming = fn; return () => {}; },
    onFlushPreferences: fn => { flush = fn; return () => {}; },
    preferencesFlushed() {}, ...overrides,
  };
  return { api, events, doc, writes, receive: value => incoming(value), requestFlush: id => flush(id),
    capture: () => captureLocalState(local), restore: (value, options) => restoreLocalState(value, { ...options, storage: local }), report() {} };
}

test('browser confirmed settings, city, growth, position and hints survive a new runtime', () => {
  const storage = memoryStorage();
  assert.equal(captureLocalState(storage), null);
  for (const [key, value] of [[SETTINGS, { appearance: { size: 210, opacity: 72, displayCurrency: 'USD' }, city: 'Shanghai' }],
    [GROWTH, { bond: 88, resourceReceipts: ['receipt-one'] }], [POSITION, { x: 123, y: 456 }], ['dsh-kujira:hint', true]])
    assert.equal(writeLocalState(key, value, storage), true);
  const next = captureLocalState(storage);
  assert.equal(next.appearance.size, 210); assert.equal(next.city, 'Shanghai');
  assert.equal(next.__growth.bond, 88); assert.equal(next.__position.x, 123); assert.equal(next.__hint, true);
  assert(next.__updatedAt > 0);
  const restored = memoryStorage(); assert(restoreLocalState(next, { storage: restored }));
  assert.deepEqual(captureLocalState(restored), next);
});

test('damaged browser JSON recovers a valid backup and resetting position removes both copies', () => {
  const storage = memoryStorage();
  writeLocalState(SETTINGS, { appearance: { size: 210 } }, storage);
  writeLocalState(SETTINGS, { appearance: { size: 220 } }, storage);
  storage.setItem(SETTINGS, '{broken');
  assert.equal(readLocalState(SETTINGS, storage).appearance.size, 210);
  writeLocalState(POSITION, { x: 1, y: 2 }, storage); writeLocalState(POSITION, { x: 3, y: 4 }, storage);
  writeLocalState(POSITION, null, storage); assert.equal(readLocalState(POSITION, storage), null);
});

test('handoff snapshots apply once across remounts and never revive old settings after host restart', () => {
  const storage = memoryStorage(); writeLocalState(POSITION, { x: 100, y: 150 }, storage);
  const presence = { instance: 'first-host', desired: 'browser', revision: 2, preferencesRevision: 2, preferences: snapshot(210, 5) };
  assert(restoreBrowserHandoff(presence, storage));
  assert.equal(readLocalState(SETTINGS, storage).appearance.size, 210);
  assert.deepEqual(readLocalState(POSITION, storage), { x: 100, y: 150 });
  writeLocalState(SETTINGS, { ...readLocalState(SETTINGS, storage), appearance: { size: 330 } }, storage);
  assert.equal(restoreBrowserHandoff(presence, storage), false);
  assert.equal(readLocalState(SETTINGS, storage).appearance.size, 330);
  assert.equal(restoreBrowserHandoff({ instance: 'restarted-host', desired: 'browser', revision: 0, preferences: null }, storage), false);
  assert.equal(readLocalState(SETTINGS, storage).appearance.size, 330);
  assert(restoreBrowserHandoff({ ...presence, instance: 'restarted-host', preferences: snapshot(250, 7) }, storage));
  assert.equal(readLocalState(SETTINGS, storage).appearance.size, 250);
});

test('growth-only handoff does not erase existing appearance or weather settings', () => {
  const storage = memoryStorage(); writeLocalState(SETTINGS, { appearance: { size: 200 }, city: 'Shanghai' }, storage);
  restoreLocalState({ __growth: { bond: 77 } }, { storage, preservePosition: true });
  assert.equal(readLocalState(SETTINGS, storage).appearance.size, 200);
  assert.equal(readLocalState(SETTINGS, storage).city, 'Shanghai');
});

test('native disk restores preferences, native settings and position after reopening', async t => {
  const file = join(await directory(t), 'desktop.json');
  const store = await createSettings(file);
  const preferences = snapshot(215, 100);
  await Promise.all([store.save({ preferences }), store.save({ position: { x: -900, y: 125 }, displayMode: 'browser' }),
    store.save({ settings: { ...store.get().settings, clickThrough: false } })]);
  await store.flush(); const reopened = await createSettings(file);
  assert.deepEqual(reopened.get().preferences, preferences);
  assert.equal(reopened.get().settings.clickThrough, false);
  assert.equal(reopened.get().displayMode, 'browser'); assert.equal(reopened.get().position.x, -900);
});

test('native corrupt main file falls back to the previous committed record', async t => {
  const file = join(await directory(t), 'desktop.json'); const store = await createSettings(file);
  await store.save({ preferences: snapshot(210, 1) }); await store.save({ preferences: snapshot(220, 2) });
  await writeFile(file, '{broken');
  const recovered = await createSettings(file); assert.equal(recovered.get().preferences.appearance.size, 210);
});

test('late renderer saves cannot overwrite a newer handoff already queued for disk', async t => {
  const file = join(await directory(t), 'desktop.json'), store = await createSettings(file);
  const handoff = store.save({ preferences: snapshot(250, 200), handoff: 'host:3' });
  assert.equal(await savePreferenceSnapshot(store, snapshot(210, 100)), false); await handoff;
  const reopened = await createSettings(file);
  assert.equal(reopened.get().preferences.appearance.size, 250); assert.equal(reopened.get().handoff, 'host:3');
  assert.equal(await savePreferenceSnapshot(store, snapshot(230, 300)), true);
  assert.equal(store.get().preferences.appearance.size, 230);
  const concurrent = await Promise.all([savePreferenceSnapshot(store, snapshot(240, 500)), savePreferenceSnapshot(store, snapshot(220, 400))]);
  assert.deepEqual(concurrent, [true, false]); assert.equal(store.get().preferences.appearance.size, 240);
});

test('failed native writes do not change committed settings and later retries remain possible', async t => {
  const root = await directory(t), file = join(root, 'blocked', 'desktop.json');
  await writeFile(join(root, 'blocked'), 'not a directory');
  const store = await createSettings(file); const previous = store.get();
  await assert.rejects(store.save({ preferences: snapshot(210, 1) }));
  assert.deepEqual(store.get(), previous);
  await rm(join(root, 'blocked')); await store.save({ preferences: snapshot(220, 2) });
  assert.equal(JSON.parse(await readFile(file, 'utf8')).preferences.appearance.size, 220);
});

test('native startup restores the file before first render when browser storage is empty', async () => {
  const local = memoryStorage(), options = bridgeOptions(local, snapshot(210, 100));
  const bridge = await connectPreferencePersistence(options);
  assert.equal(readLocalState(SETTINGS, local).appearance.size, 210);
  assert.equal(readLocalState(GROWTH, local).bond, 99);
  assert.equal(readLocalState(POSITION, local).x, 30);
  bridge.dispose();
});

test('a newer local edit survives an older native file and is backed up on startup', async () => {
  const local = memoryStorage(); restoreLocalState(snapshot(230, 200), { storage: local });
  const options = bridgeOptions(local, snapshot(210, 100));
  const bridge = await connectPreferencePersistence(options);
  assert.equal(readLocalState(SETTINGS, local).appearance.size, 230);
  assert.equal(options.writes.at(-1).appearance.size, 230); bridge.dispose();
});

test('an untouched installation does not save an empty snapshot over a backup', async () => {
  const local = memoryStorage(), options = bridgeOptions(local, null);
  const bridge = await connectPreferencePersistence(options); assert.equal(options.writes.length, 0); bridge.dispose();
});

test('city-only and growth-only changes are backed up immediately and exit waits for the newest write', async () => {
  const local = memoryStorage(); restoreLocalState(snapshot(210, 100), { storage: local });
  const options = bridgeOptions(local, captureLocalState(local));
  const bridge = await connectPreferencePersistence(options);
  writeLocalState(SETTINGS, { ...readLocalState(SETTINGS, local), city: 'Beijing' }, local);
  options.events.dispatchEvent(new Event('kujira:storage')); await bridge.flush();
  assert.equal(options.writes.at(-1).city, 'Beijing');
  let release, acknowledged = false;
  options.api.savePreferences = value => new Promise(resolve => { options.writes.push(value); release = resolve; });
  options.api.preferencesFlushed = id => { assert.equal(id, 7); acknowledged = true; };
  writeLocalState(GROWTH, { bond: 123 }, local); options.events.dispatchEvent(new Event('kujira:storage'));
  const waiting = options.requestFlush(7); assert.equal(acknowledged, false);
  writeLocalState(GROWTH, { bond: 124 }, local); options.events.dispatchEvent(new Event('kujira:storage'));
  release();
  await new Promise(resolve => setImmediate(resolve));
  release(); await waiting;
  assert.equal(acknowledged, true); assert.equal(options.writes.at(-1).__growth.bond, 124); bridge.dispose();
});

test('native save failures keep the local edit and retry on an explicit flush', async () => {
  const local = memoryStorage(); restoreLocalState(snapshot(210, 100), { storage: local });
  let failing = true, count = 0;
  const options = bridgeOptions(local, null, { savePreferences: async () => { count++; if (failing) throw Error('disk unavailable'); } });
  const bridge = await connectPreferencePersistence(options);
  assert.equal(readLocalState(SETTINGS, local).appearance.size, 210); assert.equal(count, 1);
  failing = false; await bridge.flush(); assert.equal(count, 2); bridge.dispose();
});

test('native handoff preserves its own coordinates and is saved before quit', async () => {
  const local = memoryStorage(); restoreLocalState(snapshot(210, 100), { storage: local });
  const options = bridgeOptions(local, captureLocalState(local));
  const bridge = await connectPreferencePersistence(options);
  options.receive({ ...snapshot(250, 300), __position: { x: 999, y: 999 } }); await bridge.flush();
  assert.equal(options.writes.at(-1).appearance.size, 250);
  assert.equal(options.writes.at(-1).__position.x, 30); bridge.dispose();
});

test('lifecycle flush coalesces close requests and ignores an unrelated acknowledgement', async () => {
  const sent = []; const lifecycle = createPreferenceFlush({ send: id => sent.push(id), timeout: 20 });
  const first = lifecycle.flush(), same = lifecycle.flush(); assert.equal(first, same);
  let done = false; first.then(() => { done = true; }); lifecycle.acknowledge(999);
  await Promise.resolve(); assert.equal(done, false);
  lifecycle.acknowledge(sent[0]); await first; assert.equal(done, true);
  await lifecycle.flush(); assert.equal(sent.length, 2);
});

test('full growth receipt history fits the host handoff and desktop probe limits', async () => {
  const presence = createDesktopPresence();
  const preferences = { ...snapshot(210, 1), __growth: { resourceReceipts: Array.from({ length: 512 }, (_, i) => `${String(i).padStart(4, '0')}-1234567890123456789012345678901234567890`) } };
  const body = JSON.stringify({ action: 'request', mode: 'desktop', preferences }); assert(Buffer.byteLength(body) > 16384);
  const req = Object.assign(Readable.from([body]), { method: 'POST', headers: { 'x-kujira-desktop': '1' }, socket: { remoteAddress: '127.0.0.1' } });
  const res = { writeHead(code) { this.code = code; }, end(value) { this.body = value; } };
  await presence.handle(req, res); assert.equal(res.code, 200);
  const probe = await probeDsh('http://127.0.0.1:3080', async () => new Response(res.body)); assert.equal(probe.online, true);
});

test('native position changes from resizing and reset persist without a drag', async () => {
  const area = { x: 0, y: 0, width: 1200, height: 900 }, writes = [];
  const store = { get: () => ({ settings: { display: 'remember', clickThrough: false }, position: { x: 916, y: 624 } }), save: async patch => writes.push(patch) };
  let bounds = { x: 0, y: 0, width: 820, height: 740 };
  const screen = { getPrimaryDisplay: () => ({ workArea: area }), getDisplayNearestPoint: () => ({ workArea: area }), on() {}, removeListener() {} };
  const win = { isDestroyed: () => false, isVisible: () => true, getBounds: () => bounds, setBounds: value => { bounds = value; }, setIgnoreMouseEvents() {}, webContents: { send() {} } };
  const controller = createWindowController({ win, screen, store, capabilities: {} });
  controller.place(260); controller.place(360); assert.equal(writes.at(-1).position.x, 816);
  controller.place(200, true); assert.deepEqual(writes.at(-1).position, { x: 976, y: 684 }); controller.dispose();
});
