import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";

export const DEFAULTS = Object.freeze({
  alwaysOnTop: true,
  clickThrough: true,
  allWorkspaces: false,
  login: false,
  display: "remember",
  power: "balanced",
  linuxBackend: "auto",
  dshUrl: "http://127.0.0.1:3080",
  profile: "web",
  executable: "",
  startDsh: "on-click",
  closeAction: "quit",
});

/**
 * @description Accept only a local DSH origin without credentials or redirects.
 */
export function localOrigin(value) {
  if(typeof value!=="string" || value.length>200 || /[\r\n\0]/.test(value))throw Error("invalid-origin");
  const url = new URL(value);
  if (
    url.port === "0" ||
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error("invalid-origin");
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.origin;
}

/**
 * @description Validate user settings before persistence or native operations.
 */
export function normalizeSettings(input = {}, {strict=false} = {}) {
  if(!input || typeof input!=="object" || Array.isArray(input))throw Error("invalid-settings");
  const result = { ...DEFAULTS };
  for (const key of ["alwaysOnTop", "clickThrough", "allWorkspaces", "login"])
    if (typeof input[key] === "boolean") result[key] = input[key];
    else if(strict && key in input)throw Error("invalid-settings");
  for (const [key, allowed] of Object.entries({
    display: ["remember", "primary", "cursor"],
    power: ["balanced", "saver"],
    linuxBackend: ["auto", "x11", "wayland"],
    startDsh: ["on-click", "never"],
    closeAction: ["quit", "hide"],
  })) {
    if (allowed.includes(input[key])) result[key] = input[key];
    else if(strict && key in input)throw Error("invalid-settings");
  }
  if (input.dshUrl !== undefined) result.dshUrl = localOrigin(input.dshUrl);
  if (input.profile !== undefined) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(input.profile))
      throw Error("invalid-profile");
    result.profile = input.profile;
  }
  if (input.executable !== undefined) {
    if (
      typeof input.executable !== "string" ||
      input.executable.length > 1024 ||
      /[\r\n\0]/.test(input.executable)
    )
      throw Error("invalid-executable");
    result.executable = input.executable;
  }
  return result;
}

/**
 * @description Persist desktop settings through serialized atomic writes.
 */
export async function createSettings(file) {
  let value = { settings: { ...DEFAULTS }, position: null },
    queue = Promise.resolve();
  for (const path of [file, file + ".bak"]) {
    try {
      const saved = JSON.parse(await readFile(path, "utf8"));
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw Error("invalid-settings");
      value = { ...value, ...saved, settings: normalizeSettings(saved.settings) };
      break;
    } catch (error) {
      if (error.code !== "ENOENT") console.warn("[kujira] Settings recovery:", error.code || "invalid-settings");
    }
  }
  const save = (patch) => {
    const captured = typeof patch === "function" ? patch : structuredClone(patch);
    const write = queue
      .catch(() => {})
      .then(async () => {
        const change = typeof captured === "function" ? captured(value) : captured;
        if (!change) return;
        const next = { ...value, ...change };
        const body = JSON.stringify(next);
        if (body === JSON.stringify(value)) return;
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file + ".bak.tmp", JSON.stringify(value), { mode: 0o600 });
        await rename(file + ".bak.tmp", file + ".bak");
        await writeFile(file + ".tmp", body, { mode: 0o600 });
        await rename(file + ".tmp", file);
        value = next;
      });
    queue = write;
    return write;
  };
  return { get: () => value, save, flush: () => queue };
}

/**
 * @description Resolve platform limits without pretending Wayland supports global placement.
 */
export function platformCapabilities(platform, env, backend) {
  const wayland =
    platform === "linux" &&
    (backend === "wayland" ||
      (backend === "auto" && !env.DISPLAY && !!env.WAYLAND_DISPLAY));
  return {
    platform,
    wayland,
    position: !wayland,
    alwaysOnTop: !wayland,
    clickThrough: !wayland,
    allWorkspaces: platform === "darwin",
    login: true,
  };
}
