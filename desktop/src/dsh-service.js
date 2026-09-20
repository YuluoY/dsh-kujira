import { boundedText } from "./http.js";
import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { win32, posix } from "node:path";
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
    const body = await boundedText(response, 32768);
    if (body.length > 32768) return { online: false, occupied: true };
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
 * @description Coalesce explicit starts; never stop a DSH process when the pet exits.
 */
export function createDshService({
  getSettings,
  openUrl,
  fetcher = fetch,
  spawnProcess = spawn,
  resolveExecutable = findExecutable,
  platform = process.platform,
  env = process.env,
}) {
  let pending, opening;
  const ensureRunning = () => {
    if (pending) return pending;
    pending = (async () => {
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
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline && !failed) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const result = await probeDsh(settings.dshUrl, fetcher);
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
  return { ensureRunning, openWeb, isStarting: () => !!pending || !!opening };
}
