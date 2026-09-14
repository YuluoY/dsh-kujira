import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { homedir } from "node:os";

/**
 * @description Register opt-in login startup using each platform's supported mechanism.
 */
export async function setStartup(
  app,
  enabled,
  { platform = process.platform, env = process.env } = {},
) {
  if (!app.isPackaged) throw Error("packaged-app-required");
  if (platform !== "linux") {
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath });
    return;
  }
  const base =
    env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)
      ? env.XDG_CONFIG_HOME
      : join(homedir(), ".config");
  const directory = join(base, "autostart"),
    file = join(directory, "dsh-kujira.desktop");
  if (!enabled) {
    await unlink(file).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    return;
  }
  const executable = env.APPIMAGE || process.execPath;
  if (/[\r\n\0%]/.test(executable)) throw Error("invalid-autostart-path");
  const escaped = executable.replace(/[\\"`$]/g, "\\$&");
  await mkdir(directory, { recursive: true });
  await writeFile(
    file,
    `[Desktop Entry]\nType=Application\nName=Kujira\nExec="${escaped}"\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`,
    { mode: 0o600 },
  );
}
