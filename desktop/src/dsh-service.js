import { boundedText } from "./http.js";
import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, dirname, join, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { localOrigin } from "./settings.js";

/**
 * @description Find the existing CLI without invoking an interactive shell.
 */
export async function findExecutable(
  configured,
  { platform = process.platform, env = process.env } = {},
) {
  const roots = (env.PATH || "").split(delimiter).filter(Boolean);
  roots.push(
    join(homedir(), "Library/pnpm"),
    join(homedir(), ".local/share/pnpm"),
    join(homedir(), ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  );
  if (env.APPDATA) roots.push(join(env.APPDATA, "npm"));
  if (env.PNPM_HOME) roots.push(env.PNPM_HOME);
  const names = platform === "win32" ? ["dsh.exe", "dsh.cmd"] : ["dsh"];
  if (configured && !isAbsolute(configured))
    throw Error("absolute-path-required");
  const candidates = configured
    ? [configured]
    : roots.flatMap((root) => names.map((name) => join(root, name)));
  for (const file of candidates) {
    try {
      await access(
        file,
        platform === "win32" ? constants.F_OK : constants.X_OK,
      );
      if ((await stat(file)).isFile()) return file;
    } catch {
      /* Try the next installed CLI. */
    }
  }
  throw Error("dsh-not-found");
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
}) {
  let pending;
  const openWeb = () => {
    if (pending) return pending;
    pending = (async () => {
      const settings = { ...getSettings() };
      const initial = await probeDsh(settings.dshUrl, fetcher);
      if (initial.online || initial.legacy) {
        await openUrl(settings.dshUrl);
        return;
      }
      if (initial.occupied) throw Error("port-occupied-or-plugin-old");
      if (settings.startDsh === "never") throw Error("dsh-offline");
      const executable = await resolveExecutable(settings.executable);
      const command = launchCommand(executable, settings);
      let failed = false;
      const commandEnv = {
        ...process.env,
        PATH: [
          dirname(executable),
          process.env.PATH || "",
          "/opt/homebrew/bin",
          "/usr/local/bin",
        ].join(delimiter),
      };
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
        if ((await probeDsh(settings.dshUrl, fetcher)).online) {
          await openUrl(settings.dshUrl);
          return;
        }
      }
      throw Error(failed ? "dsh-start-failed" : "dsh-start-timeout");
    })().finally(() => {
      pending = null;
    });
    return pending;
  };
  return { openWeb, isStarting: () => !!pending };
}
