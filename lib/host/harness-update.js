import { mkdir, readFile, writeFile, rename, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { compareVersions, detectHarness, installedVersion, installCommand, runCommand, NPM_REGISTRY, HARNESS_PACKAGE } from "./harness-install.js";
import { untilAbort } from "./async-work.js";
import { inspectHarnessDependencies, prepareHarnessDependencies, validHarnessMetadata } from "./harness-dependencies.js";

const DAY = 86400000;
const CHANNELS = ["auto", "latest", "alpha"];

/**
 * @description Choose the newest official tag within the selected release channel without downgrades.
 * @param {object} tags Official npm distribution tags.
 * @param {string} channel User channel preference.
 * @param {string} current Installed semantic version.
 * @returns {string|null} Validated target version.
 */
export function updateTarget(tags, channel, current) {
  const selected = channel === "auto" ? (current?.includes("-alpha") ? "alpha" : "latest") : channel;
  const versions = [tags?.latest, tags?.[selected]].filter((version) => {
    try { compareVersions(version, version); return true; } catch { return false; }
  });
  return versions.sort(compareVersions).at(-1) || null;
}

/**
 * @description Manage daily checks and explicit, serialized updates of the current DSH installation.
 * @param {object} options Installation adapters, storage, registry transport and active task accessor.
 * @returns {object} Status, settings, check and install operations.
 */
export function createHarnessUpdater({
  directory = join(homedir(), ".dsh", "dsh-kujira"),
  lockDirectory = join(homedir(), ".dsh", "dsh-kujira"),
  fetch: request = globalThis.fetch,
  detect = detectHarness,
  verify = installedVersion,
  run = runCommand,
  inspect = inspectHarnessDependencies,
  prepare = prepareHarnessDependencies,
  now = Date.now,
  activeTasks = () => null,
  disabled = false,
  preview = false,
} = {}) {
  const file = join(directory, "harness-update.json");
  const lock = join(lockDirectory, "harness-update.lock");
  const abort = new AbortController();
  let settings = { automatic: true, channel: "auto" }, installation = null, tags = {};
  let checkedAt = 0, attemptedAt = 0, phase = "idle", error = "", disposed = false;
  let checking = null, installing = null, saving = Promise.resolve(), listing = null;
  let versions = [], versionsAt = 0, previousVersions = [];
  let dependencyIssues = [], dependenciesChecked = false, repaired = false;
  const status = () => {
    const latest = updateTarget(tags, settings.channel, installation?.installed);
    const available = !!latest && !!installation?.installed && compareVersions(latest, installation.installed) > 0;
    const active = activeTasks();
    return { ok: true, settings: { ...settings }, current: installation?.current || null,
      installed: installation?.installed || null, latest, available, checkedAt, phase, error,
      manager: installation?.manager || null, supported: !!installation?.supported,
      versions, previousVersions, versionsAt,
      dependencyIssues, needsRepair: dependenciesChecked && dependencyIssues.length > 0,
      reason: installation?.reason || "", activeTasks: active, preview, disabled,
      canInstall: !disabled && !preview && !!installation?.supported && available && active === 0 && phase !== "installing",
      canChangeVersion: !disabled && !preview && !!installation?.supported && active === 0 && phase === "idle",
      canRepair: !disabled && !preview && !!installation?.supported && dependenciesChecked && dependencyIssues.length > 0 && active === 0 && phase === "idle",
      restartRequired: repaired || (!!installation?.installed && installation.current !== installation.installed) };
  };
  async function inspectInstallation() {
    dependenciesChecked = false;
    const result = await inspect(installation);
    dependencyIssues = result.issues;
    dependenciesChecked = true;
  }
  const save = () => {
    if (disabled || preview) return Promise.resolve();
    const body = JSON.stringify({ settings, tags, checkedAt, attemptedAt, previousVersions });
    const work = saving.catch(() => {}).then(async () => {
      await mkdir(directory, { recursive: true });
      await writeFile(file + ".tmp", body, { mode: 0o600 });
      await rename(file + ".tmp", file);
    });
    saving = work;
    return work;
  };
  const ready = (async () => {
    if (!disabled && !preview) {
      try {
        const raw = await readFile(file, "utf8");
        if (raw.length > 8192) throw Error();
        const saved = JSON.parse(raw);
        if (typeof saved.settings?.automatic === "boolean") settings.automatic = saved.settings.automatic;
        if (CHANNELS.includes(saved.settings?.channel)) settings.channel = saved.settings.channel;
        for (const key of ["latest", "alpha"]) {
          try { compareVersions(saved.tags?.[key], saved.tags?.[key]); tags[key] = saved.tags[key]; } catch { /* Ignore invalid cached tags. */ }
        }
        checkedAt = Number(saved.checkedAt) || 0;
        attemptedAt = Number(saved.attemptedAt) || 0;
        if (checkedAt > now() || attemptedAt > now()) checkedAt = attemptedAt = 0;
        previousVersions = Array.isArray(saved.previousVersions) ? saved.previousVersions.filter((version) => {
          try { compareVersions(version, version); return true; } catch { return false; }
        }).slice(0, 16) : [];
      } catch { /* First run and damaged cache use default check settings. */ }
    }
    if (!disabled) {
      try {
        installation = await detect();
        if (installation?.supported) {
          try { await inspectInstallation(); } catch { error = "dependency-check-failed"; }
        }
      }
      catch { error = "detect-failed"; }
    }
  })();
  async function registry(path, limit = 262144) {
    const response = await request(NPM_REGISTRY + path, { headers: { Accept: path === "/@deepseek-ai%2Fdsh" ? "application/vnd.npm.install-v1+json" : "application/json" },
      redirect: "error", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]) });
    if (!response.ok) throw Error("registry-unavailable");
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); throw Error("registry-invalid"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  async function listVersions() {
    await ready;
    if (disabled || disposed || installing || (versionsAt && now() - versionsAt < DAY)) return status();
    if (listing) return listing;
    listing = (async () => {
      try {
        const metadata = await registry("/@deepseek-ai%2Fdsh", 4 * 1024 * 1024);
        if (metadata.name !== HARNESS_PACKAGE || !metadata.versions) throw Error("registry-invalid");
        versions = Object.keys(metadata.versions).filter((version) => {
          try { compareVersions(version, version); return !metadata.versions[version].deprecated; } catch { return false; }
        }).sort((a, b) => compareVersions(b, a)).slice(0, 200);
        if (!versions.length) throw Error("registry-invalid");
        versionsAt = now(); error = "";
      } catch { error = "versions-failed"; }
      return status();
    })();
    try { return await listing; } finally { listing = null; }
  }
  async function check({ manual = false } = {}) {
    await ready;
    if (disabled || disposed || installing) return status();
    if (checking) return checking;
    if ((!manual && !settings.automatic) || (attemptedAt && now() - attemptedAt < (manual ? 60000 : checkedAt === attemptedAt ? DAY : 3600000))) return status();
    checking = (async () => {
      attemptedAt = now(); phase = "checking"; error = "";
      try {
        if (installation?.supported) {
          await inspectInstallation();
        }
        const next = await registry("/-/package/@deepseek-ai/dsh/dist-tags");
        const validated = {};
        for (const key of ["latest", "alpha"]) {
          if (!next[key]) continue;
          compareVersions(next[key], next[key]); validated[key] = next[key];
        }
        if (!validated.latest) throw Error("registry-invalid");
        tags = validated; checkedAt = attemptedAt;
      } catch { error = "check-failed"; }
      phase = "idle";
      try { await save(); } catch { error = "save-failed"; }
      return status();
    })();
    try { return await checking; } finally { checking = null; }
  }
  async function acquireLock() {
    await mkdir(lockDirectory, { recursive: true });
    try {
      const handle = await open(lock, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify({ pid: process.pid })); }
      finally { await handle.close(); }
    } catch (failure) {
      if (failure.code !== "EEXIST") throw failure;
      const previous = JSON.parse(await readFile(lock, "utf8"));
      if (!Number.isInteger(previous.pid) || previous.pid <= 0) throw Error("update-locked");
      try { process.kill(previous.pid, 0); }
      catch (failure) {
        if (failure.code === "ESRCH") { await unlink(lock); return acquireLock(); }
      }
      throw Error("update-locked");
    }
  }
  async function install(version, { selected = false, repair = false } = {}) {
    await ready;
    if (installing) return status();
    const state = status();
    if (repair ? !state.canRepair || version !== installation.installed
      : selected ? !state.canChangeVersion || !versions.includes(version) || now() - versionsAt > DAY || version === installation.installed
      : !state.canInstall || version !== state.latest || now() - checkedAt > DAY) throw Error("update-not-ready");
    if (checking || listing) throw Error("update-not-ready");
    phase = "installing"; error = "";
    installing = (async () => {
      let locked = false;
      try {
        await acquireLock(); locked = true;
        const fresh = state.restartRequired ? { ...installation, installed: await verify(installation) } : await detect();
        if (!fresh.supported || fresh.path !== installation.path || fresh.manager !== installation.manager) throw Error("installation-changed");
        if ((!repair && version === fresh.installed) || (!selected && compareVersions(version, fresh.installed) < 0)) { installation.installed = fresh.installed; return; }
        const metadata = await registry(`/@deepseek-ai%2Fdsh/${version}`);
        if (!validHarnessMetadata(metadata, HARNESS_PACKAGE, version)) throw Error("registry-invalid");
        const packages = await prepare(fresh, version, { registry, run, inspect, signal: abort.signal });
        if (activeTasks() !== 0 || disposed) throw Error("tasks-running");
        await run(installCommand(fresh, version, packages), { timeout: 10 * 60000, signal: abort.signal, env: { ...process.env, CI: "1" } });
        if (repair) repaired = true;
        const installed = await verify(fresh);
        if (installed !== version) throw Error("verify-failed");
        installation.installed = installed;
        await inspectInstallation();
        if (dependencyIssues.length) {
          const reconciled = await prepare(installation, version, { registry, run, inspect, signal: abort.signal });
          if (reconciled.some((name) => !packages.includes(name))) {
            if (activeTasks() !== 0 || disposed) throw Error("tasks-running");
            await run(installCommand(installation, version, reconciled), { timeout: 10 * 60000, signal: abort.signal, env: { ...process.env, CI: "1" } });
            if (await verify(installation) !== version) throw Error("verify-failed");
            await inspectInstallation();
          }
        }
        if (dependencyIssues.length) throw Error("dependency-verify-failed");
        if (fresh.installed !== installed) previousVersions = [fresh.installed, ...previousVersions.filter((old) => old !== fresh.installed)].slice(0, 16);
        try { await save(); } catch { error = "save-failed"; }
      } catch (failure) {
        const known = ["update-locked", "installation-changed", "registry-invalid", "tasks-running", "verify-failed", "update-timeout", "command-unavailable",
          "dependency-check-failed", "dependency-release-unavailable", "dependency-verify-failed"];
        error = known.includes(failure.message) ? failure.message : "install-failed";
      } finally {
        if (locked) await unlink(lock).catch(() => {});
        phase = "idle";
      }
    })();
    installing.finally(() => { installing = null; });
    return status();
  }
  async function configure(patch) {
    await ready;
    if (installing || checking || disabled || preview) throw Error("update-busy");
    if (!patch || typeof patch !== "object" || Array.isArray(patch) ||
        Object.keys(patch).some((key) => !["automatic", "channel"].includes(key)) ||
        ("automatic" in patch && typeof patch.automatic !== "boolean") ||
        ("channel" in patch && !CHANNELS.includes(patch.channel))) throw Error("invalid-settings");
    const previous = settings;
    settings = { ...settings, ...patch };
    try { await save(); } catch { settings = previous; throw Error("save-failed"); }
    return status();
  }
  return { ready, status, check, listVersions, install, configure,
    async gate(payload, next) {
      if (installing) await untilAbort(installing, payload.signal);
      if (payload.signal?.aborted) throw payload.signal.reason || Error("aborted");
      return next();
    },
    settled: () => installing || Promise.resolve(),
    dispose() { disposed = true; abort.abort(); } };
}
