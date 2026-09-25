import { boundedText } from "./http.js";
import { spawn, execFile } from "node:child_process";
import { access, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { win32, posix, dirname } from "node:path";
import { homedir } from "node:os";
import { localOrigin } from "./settings.js";

/**
 * @description Find the existing CLI without invoking an interactive shell.
 */
export async function findExecutable(configured, { platform = process.platform, env = process.env,
  home = homedir(), fs = { access, stat } } = {}) {
  const paths = platform === "win32" ? win32 : posix;
  const roots = executableSearchPaths({ platform, env, home });
  const names = platform === "win32" ? ["dsh.exe", "dsh.cmd", "dsh.bat"] : ["dsh"];
  if (configured && !paths.isAbsolute(configured))
    throw Error("absolute-path-required");
  const candidates = configured
    ? [configured]
    : roots.flatMap((root) => names.map((name) => paths.join(root, name)));
  for (const file of candidates) {
    try {
      await fs.access(
        file,
        platform === "win32" ? constants.F_OK : constants.X_OK,
      );
      if ((await fs.stat(file)).isFile()) return file;
    } catch {
      /* Try the next installed CLI. */
    }
  }
  throw Error("dsh-not-found");
}

/**
 * @description Collect absolute CLI search paths using the target operating system's conventions.
 * @param {object} options Platform, environment and home directory.
 * @returns {string[]} Deduplicated directories for CLI lookup and child process PATH.
 */
export function executableSearchPaths({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  const paths = platform === "win32" ? win32 : posix;
  const key = Object.keys(env).find((name) => platform === "win32" ? name.toLowerCase() === "path" : name === "PATH");
  const roots = [...(env[key] || "").split(paths.delimiter), env.PNPM_HOME,
    ...(platform === "win32"
      ? [env.APPDATA && paths.join(env.APPDATA, "npm"), env.LOCALAPPDATA && paths.join(env.LOCALAPPDATA, "pnpm"),
        env.ProgramFiles && paths.join(env.ProgramFiles, "nodejs"), env.NVM_SYMLINK]
      : [paths.join(home, "Library", "pnpm"), paths.join(home, ".local", "share", "pnpm"),
        paths.join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"])];
  return [...new Set(roots.filter(Boolean).map((root) => root.replace(/^"(.*)"$/, "$1")).filter((root) => paths.isAbsolute(root)))];
}

/**
 * @description Build fixed DSH arguments, including a validated Windows shim invocation.
 */
export function launchCommand(
  executable,
  settings,
  platform = process.platform,
  env = process.env,
) {
  const origin = new URL(localOrigin(settings.dshUrl));
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(settings.profile))
    throw Error("invalid-profile");
  const args = [
    "--profile",
    settings.profile,
    "--no-open",
    "--host",
    origin.hostname === "[::1]" ? "::1" : "127.0.0.1",
    "--port",
    origin.port || "80",
  ];
  if (platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    if (/["%&|<>^!\r\n]/.test(executable)) throw Error("unsafe-windows-path");
    return {
      file: env.ComSpec || "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", '""' + executable + '" ' + args.join(" ") + '"'],
      verbatim: true,
    };
  }
  return { file: executable, args, verbatim: false };
}

/**
 * @description Identify the plugin before opening or controlling a local DSH service.
 */
export async function probeDsh(origin, fetcher = fetch) {
  let responded = false;
  try {
    const response = await fetcher(
      localOrigin(origin) + "/dsh-kujira/desktop",
      { signal: AbortSignal.timeout(2000), redirect: "error" },
    );
    responded = true;
    if (!response.ok) {
      if (response.status === 404) {
        const metaResponse = await fetcher(
          localOrigin(origin) + "/dsh-kujira/meta",
          { signal: AbortSignal.timeout(2000), redirect: "error" },
        );
        const meta = metaResponse.ok
          ? JSON.parse(await boundedText(metaResponse, 32768))
          : null;
        if (meta?.name === "dsh-kujira" && meta.route === "/dsh-kujira")
          return { online: false, occupied: true, legacy: true };
      }
      return { online: false, occupied: true };
    }
    const body = await boundedText(response, 192 * 1024);
    const data = JSON.parse(body);
    return data.product === "dsh-kujira" &&
      data.protocol === 1 &&
      typeof data.instance === "string"
      ? { online: true, presence: data }
      : { online: false, occupied: true };
  } catch (error) {
    return {
      online: false,
      occupied:
        responded ||
        (error.cause?.code !== "ECONNREFUSED" &&
          !error.cause?.errors?.every((item) => item.code === "ECONNREFUSED")),
    };
  }
}

/**
 * @description Stop only after a registered browser tab has actually disappeared.
 * @param {number} previousCount Browser tabs seen on the previous presence snapshot.
 * @param {number} nextCount Browser tabs seen now.
 * @returns {boolean} Whether an owned service should be released.
 */
export function shouldReleaseOwnedService(previousCount, nextCount) {
  return previousCount > 0 && nextCount === 0;
}

/**
 * @description Read a previously recorded spawn without adopting a foreign service.
 */
function parseOwnership(body) {
  const data = JSON.parse(body);
  if (
    !data ||
    typeof data !== "object" ||
    !Number.isInteger(data.pid) ||
    data.pid <= 0 ||
    typeof data.instance !== "string" ||
    !data.instance ||
    data.instance.length > 80 ||
    typeof data.origin !== "string" ||
    typeof data.profile !== "string" ||
    !Number.isInteger(data.startedAt)
  )
    return null;
  return {
    pid: data.pid,
    instance: data.instance,
    origin: localOrigin(data.origin),
    profile: data.profile,
    startedAt: data.startedAt,
  };
}

/**
 * @description End one process tree without a shell. Unix targets the detached process group.
 */
export async function terminateProcessTree(pid, { force = false, platform = process.platform, exec = execFile, signal = process.kill } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) throw Error("invalid-pid");
  if (platform === "win32") {
    const args = ["/PID", String(pid), "/T"];
    if (force) args.push("/F");
    await new Promise((resolve, reject) => {
      exec("taskkill", args, { windowsHide: true, shell: false }, (error) => error && error.code !== 128 ? reject(error) : resolve());
    });
    return;
  }
  const name = force ? "SIGKILL" : "SIGTERM";
  try {
    signal(-pid, name);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
    try {
      signal(pid, name);
    } catch (again) {
      if (again.code !== "ESRCH") throw again;
    }
  }
}

/**
 * @description Coalesce explicit starts and remember only the process this pet spawned.
 */
export function createDshService({
  getSettings,
  openUrl,
  fetcher = fetch,
  spawnProcess = spawn,
  resolveExecutable = findExecutable,
  platform = process.platform,
  env = process.env,
  ownershipFile = "",
  terminate = terminateProcessTree,
  processAlive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code === "EPERM";
    }
  },
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  stopTimeout = 5000,
  now = Date.now,
  fs = { mkdir, readFile, rename, unlink, writeFile },
}) {
  let pending, opening, stopping, record = null;
  const load = ownershipFile
    ? fs.readFile(ownershipFile, "utf8").then((body) => {
        record = parseOwnership(body);
      }).catch(() => {
        record = null;
      })
    : Promise.resolve();
  const remember = async (next) => {
    record = next;
    if (!ownershipFile || !next) return;
    await fs.mkdir(dirname(ownershipFile), { recursive: true });
    const temporary = ownershipFile + ".tmp";
    await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
    await fs.rename(temporary, ownershipFile);
  };
  const forget = async () => {
    record = null;
    if (!ownershipFile) return;
    await fs.unlink(ownershipFile).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  };
  const matchesSettings = (value, settings) =>
    value &&
    value.origin === localOrigin(settings.dshUrl) &&
    value.profile === settings.profile;
  const ensureRunning = () => {
    if (pending) return pending;
    pending = (async () => {
      await load;
      const settings = { ...getSettings() };
      const initial = await probeDsh(settings.dshUrl, fetcher);
      if (initial.online || initial.legacy) {
        return initial;
      }
      if (initial.occupied) throw Error("port-occupied-or-plugin-old");
      if (settings.startDsh === "never") throw Error("dsh-offline");
      const executable = await resolveExecutable(settings.executable, { platform, env });
      const command = launchCommand(executable, settings, platform, env);
      let failed = false;
      const paths = platform === "win32" ? win32 : posix;
      const commandEnv = { ...env };
      for (const key of Object.keys(commandEnv)) {
        if (platform === "win32" ? key.toLowerCase() === "path" : key === "PATH") delete commandEnv[key];
      }
      commandEnv.PATH = [paths.dirname(executable), ...executableSearchPaths({ platform, env })].join(paths.delimiter);
      const child = spawnProcess(command.file, command.args, {
        detached: true,
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: command.verbatim,
        env: commandEnv,
        stdio: "ignore",
      });
      child.once("error", () => {
        failed = true;
      });
      child.once("exit", () => {
        failed = true;
      });
      child.unref();
      const deadline = now() + 30000;
      while (now() < deadline && !failed) {
        await sleep(700);
        const result = await probeDsh(settings.dshUrl, fetcher);
        if (result.online && result.presence?.instance && Number.isInteger(child.pid) && child.pid > 0) {
          await remember({
            pid: child.pid,
            instance: result.presence.instance,
            origin: localOrigin(settings.dshUrl),
            profile: settings.profile,
            startedAt: now(),
          });
        }
        if (result.online || result.legacy) return result;
      }
      throw Error(failed ? "dsh-start-failed" : "dsh-start-timeout");
    })().finally(() => {
      pending = null;
    });
    return pending;
  };
  const openWeb = () => {
    if (opening) return opening;
    const origin = getSettings().dshUrl;
    opening = ensureRunning().then(() => openUrl(origin)).finally(() => { opening = null; });
    return opening;
  };
  const owns = (snapshot) => {
    const settings = getSettings();
    return !!(
      snapshot?.online &&
      matchesSettings(record, settings) &&
      snapshot.presence?.instance === record.instance
    );
  };
  const stopOwned = () => {
    if (stopping) return stopping;
    stopping = (async () => {
      await load;
      const settings = { ...getSettings() };
      const owned = record;
      if (!matchesSettings(owned, settings)) {
        if (owned) await forget();
        return { stopped: false, reason: owned ? "stale" : "not-owned" };
      }
      const probe = await probeDsh(settings.dshUrl, fetcher);
      if (!probe.online || probe.presence?.instance !== owned.instance) {
        await forget();
        return { stopped: false, reason: probe.online ? "instance-mismatch" : "offline" };
      }
      if (!processAlive(owned.pid)) {
        await forget();
        return { stopped: false, reason: "process-gone" };
      }
      await terminate(owned.pid, { force: false, platform });
      const deadline = now() + stopTimeout;
      let current = probe;
      while (now() < deadline) {
        await sleep(200);
        current = await probeDsh(settings.dshUrl, fetcher);
        if (!current.online || current.presence?.instance !== owned.instance) break;
      }
      if (current.online && current.presence?.instance === owned.instance)
        await terminate(owned.pid, { force: true, platform });
      await forget();
      return { stopped: true };
    })().finally(() => {
      stopping = null;
    });
    return stopping;
  };
  return {
    ensureRunning,
    openWeb,
    owns,
    stopOwned,
    ready: load,
    ownership: () => record,
    isStarting: () => !!pending || !!opening,
  };
}
