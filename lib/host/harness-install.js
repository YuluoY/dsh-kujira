import { spawn } from "node:child_process";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, isAbsolute, win32, posix } from "node:path";
import { homedir } from "node:os";

export const HARNESS_PACKAGE = "@deepseek-ai/dsh";
export const NPM_REGISTRY = "https://registry.npmjs.org";

/**
 * @description Compare validated semantic versions, including numeric prerelease identifiers.
 * @param {string} left First version.
 * @param {string} right Second version.
 * @returns {number} Negative, zero or positive ordering.
 */
export function compareVersions(left, right) {
  const parse = (value) => {
    if (typeof value !== "string" || value.length > 80 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(value)) throw Error("invalid-version");
    const [base, ...pre] = value.split("-");
    return { base: base.split(".").map(Number), pre: pre.join("-").split(".").filter(Boolean) };
  };
  const a = parse(left), b = parse(right);
  for (let i = 0; i < 3; i++) if (a.base[i] !== b.base[i]) return Math.sign(a.base[i] - b.base[i]);
  if (!a.pre.length || !b.pre.length) return Math.sign(b.pre.length - a.pre.length);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === b.pre[i]) continue;
    if (a.pre[i] === undefined) return -1;
    if (b.pre[i] === undefined) return 1;
    const an = /^\d+$/.test(a.pre[i]), bn = /^\d+$/.test(b.pre[i]);
    if (an && bn) return Math.sign(Number(a.pre[i]) - Number(b.pre[i]));
    if (an !== bn) return an ? -1 : 1;
    return a.pre[i] < b.pre[i] ? -1 : 1;
  }
  return 0;
}

/**
 * @description Run a fixed executable without a shell, with bounded output and elapsed time.
 * @param {object} command Executable and argument vector.
 * @param {object} options Timeout, environment and cancellation.
 * @returns {Promise<string>} Standard output on successful exit.
 */
export function runCommand({ file, args }, { timeout = 15000, signal, env = process.env,
  platform = process.platform, spawnProcess = spawn, killProcess = process.kill } = {}) {
  if (signal?.aborted) return Promise.reject(Error("update-cancelled"));
  return new Promise((resolve, reject) => {
    const child = spawnProcess(file, args, { shell: false, detached: platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: managerEnvironment(env) });
    let output = "", fault, killTimer;
    const stop = (reason) => {
      if (fault) return;
      fault = reason;
      if (!child.pid) return;
      if (platform === "win32") {
        const killer = spawnProcess("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" });
        killer.once("error", () => child.kill());
        killer.once("close", (code) => { if (code !== 0) child.kill(); });
        killTimer = setTimeout(() => { killer.kill(); child.kill(); }, 2000);
      } else {
        try { killProcess(-child.pid, "SIGTERM"); } catch { child.kill(); }
        killTimer = setTimeout(() => { try { killProcess(-child.pid, "SIGKILL"); } catch { /* Process group already exited. */ } }, 2000);
      }
    };
    const timer = setTimeout(() => stop("update-timeout"), timeout);
    const abort = () => stop("update-cancelled");
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-65536); });
    child.stderr.on("data", () => {});
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener("abort", abort); };
    child.once("error", () => { cleanup(); reject(Error("command-unavailable")); });
    child.once("close", (code) => { cleanup(); if (fault || code !== 0) reject(Error(fault || "install-failed")); else resolve(output.trim()); });
  });
}

/**
 * @description Enumerate installed native or Node package manager entry points on each platform.
 * @param {string} name Allowed package manager name.
 * @param {object} options Platform, environment and filesystem adapters.
 * @returns {AsyncGenerator<object>} Unique executable commands in discovery order.
 */
export async function* managerCommands(name, { env = process.env, platform = process.platform,
  home = homedir(), execPath = process.execPath, fs = { realpath, access, stat } } = {}) {
  if (!["npm", "pnpm"].includes(name)) return;
  const paths = platform === "win32" ? win32 : posix;
  const pathKey = Object.keys(env).find((key) => platform === "win32" ? key.toLowerCase() === "path" : key === "PATH");
  const roots = [...(env[pathKey] || "").split(paths.delimiter), env.PNPM_HOME, paths.dirname(execPath),
    ...(platform === "win32"
      ? [env.APPDATA && paths.join(env.APPDATA, "npm"), env.LOCALAPPDATA && paths.join(env.LOCALAPPDATA, "pnpm")]
      : [paths.join(home, "Library", "pnpm"), paths.join(home, ".local", "share", "pnpm"),
        paths.join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"])];
  const seen = new Set();
  for (const root of roots) {
    const directory = root?.replace(/^"(.*)"$/, "$1");
    if (!directory || !paths.isAbsolute(directory)) continue;
    const candidates = [paths.join(directory, platform === "win32" ? name + ".exe" : name)];
    for (const modules of [paths.join(directory, "node_modules"), paths.join(directory, "..", "lib", "node_modules")]) {
      candidates.push(paths.join(modules, name, "bin", name === "pnpm" ? "pnpm.cjs" : "npm-cli.js"),
        paths.join(modules, "corepack", "dist", name + ".js"));
    }
    for (const candidate of candidates) {
      try {
        const path = await fs.realpath(candidate);
        const key = platform === "win32" ? path.toLowerCase() : path;
        if (seen.has(key) || !(await fs.stat(path)).isFile()) continue;
        seen.add(key);
        const script = /\.[cm]?js$/i.test(path);
        if (platform === "win32" && !script && !/\.exe$/i.test(path)) continue;
        await fs.access(path, script || platform === "win32" ? constants.F_OK : constants.X_OK);
        yield script ? { file: execPath, args: [path] } : { file: path, args: [] };
      } catch {
        // Continue through installed package manager locations.
      }
    }
  }
}

async function packageAt(path) {
  try {
    const value = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
    if (value.name !== HARNESS_PACKAGE) return null;
    compareVersions(value.version, value.version);
    return { root: await realpath(path), version: value.version };
  } catch { return null; }
}

/**
 * @description Identify the running Harness installation and its matching global package manager.
 * @param {object} options Running entry path, environment and process runner.
 * @returns {Promise<object>} Installation identity and supported update plan.
 */
export async function detectHarness({ entry = process.argv[1], env = process.env, run = runCommand,
  commands = managerCommands, platform = process.platform } = {}) {
  let running = null;
  if (entry) {
    let directory;
    try { directory = dirname(await realpath(entry)); } catch { directory = null; }
    for (let depth = 0; directory && depth < 6; depth++) {
      running = await packageAt(directory);
      if (running) break;
      const parent = dirname(directory);
      directory = parent === directory ? null : parent;
    }
  }
  for (const manager of ["pnpm", "npm"]) {
    for await (const command of commands(manager, { env, platform })) {
      try {
        const globalRoot = await run({ file: command.file, args: [...command.args, "root", "--global"] }, { env: managerEnvironment(env) });
        if (!isAbsolute(globalRoot) || /[\r\n]/.test(globalRoot)) continue;
        const path = join(globalRoot, "@deepseek-ai", "dsh");
        const installed = await packageAt(path);
        const identity = (value) => platform === "win32" ? value.toLowerCase() : value;
        if (!installed || (running && identity(running.root) !== identity(installed.root))) continue;
        return { current: running?.version || installed.version, installed: installed.version,
          manager, command, path, supported: !!running, reason: running ? "" : "unrecognized-host" };
      } catch {
        // Another manager may own the running installation.
      }
    }
  }
  return { current: running?.version || null, installed: running?.version || null, supported: false, reason: "unsupported-install" };
}

function managerEnvironment(env) {
  return { ...env, COREPACK_ENABLE_PROJECT_SPEC: "0", COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" };
}

/**
 * @description Build a pinned official package update through the detected installation's manager.
 * @param {object} installation Verified global installation.
 * @param {string} version Validated target version.
 * @param {string[]} packages Reachable official dependencies included in the same release transaction.
 * @returns {object} Executable and arguments without shell interpolation.
 */
export function installCommand(installation, version, packages = []) {
  compareVersions(version, version);
  if (!installation.supported || !["npm", "pnpm"].includes(installation.manager)) throw Error("unsupported-install");
  if (!Array.isArray(packages) || packages.some((name) => !/^@deepseek-ai\/dsh(?:-[a-z0-9]+)+$/.test(name))) throw Error("invalid-package");
  const targets = [HARNESS_PACKAGE, ...new Set(packages)].map((name) => `${name}@${version}`);
  const args = installation.manager === "pnpm"
    ? ["add", "--global", ...targets, `--registry=${NPM_REGISTRY}`, "--config.engine-strict=true", "--reporter=append-only"]
    : ["install", "--global", ...targets, `--registry=${NPM_REGISTRY}`, "--engine-strict", "--no-audit", "--no-fund"];
  return { file: installation.command.file, args: [...installation.command.args, ...args] };
}

/**
 * @description Verify the actual package version written by the package manager.
 * @param {object} installation Original global package alias.
 * @returns {Promise<string|null>} Installed version after update.
 */
export async function installedVersion(installation) {
  return (await packageAt(installation.path))?.version || null;
}
