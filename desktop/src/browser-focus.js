import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const browsers = {
  chrome: ["com.google.Chrome", "chrome", "google-chrome"],
  edge: ["com.microsoft.edgemac", "msedge", "microsoft-edge"],
  firefox: ["org.mozilla.firefox", "firefox", "firefox"],
  safari: ["com.apple.Safari", "", ""],
  codex: ["com.openai.codex", "", ""],
};

/**
 * @description Activate a registered browser application without opening another URL.
 * @param {string} kind Allowlisted browser identity.
 * @param {string} platform Operating system.
 * @param {Function} run Executable runner.
 * @param {string} origin Local DSH origin.
 * @param {object} options Acknowledged navigation marker and environment.
 * @returns {Promise<boolean>} Whether the intended window was activated.
 */
export async function focusBrowser(
  kind,
  platform = process.platform,
  run = execute,
  origin,
  { focusToken, env = process.env, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {},
) {
  const browser = browsers[kind];
  if (!browser) return false;
  if (focusToken && !/^[0-9a-f-]{36}$/.test(focusToken)) return false;
  const marker = focusToken ? `[Kujira:${focusToken}]` : "";
  try {
    if (platform === "darwin") {
      if (origin && ["chrome", "edge", "safari"].includes(kind)) {
        const script = `ObjC.import("AppKit");
function run(argv) {
  var origin=argv[0], apps=$.NSRunningApplication.runningApplicationsWithBundleIdentifier(argv[1]);
  for(var a=0;a<Math.min(apps.count,8);a++) {
    var browser=Application(Number(apps.objectAtIndex(a).processIdentifier));
    var windows=browser.windows();
    for(var w=0;w<Math.min(windows.length,100);w++) {
      var tabs=windows[w].tabs();
      for(var i=0;i<Math.min(tabs.length,1000);i++) {
        var url=String(tabs[i].url());
        var title=String(argv[2]==="safari" ? tabs[i].name() : tabs[i].title());
        if((url===origin || url.indexOf(origin+"/")===0) && (!argv[3] || title.indexOf(argv[3])===0)) {
          if(argv[2]==="safari") windows[w].currentTab=tabs[i];
          else windows[w].activeTabIndex=i+1;
          windows[w].index=1;
          browser.activate();
          return "matched";
        }
      }
    }
  }
  return "missing";
}`;
        const result = await run(
          "/usr/bin/osascript",
          ["-l", "JavaScript", "-e", script, origin, browser[0], kind, marker],
          { timeout: 10000 },
        );
        console.info("[kujira] Existing browser tab:", result.stdout?.trim());
        return result.stdout?.trim() === "matched";
      }
      if (origin || marker) return false;
      await run("/usr/bin/open", ["-b", browser[0]], { timeout: 2000 });
    } else if (platform === "win32" && browser[1]) {
      if (!marker) return false;
      const script = `$ErrorActionPreference = 'Stop';
Add-Type -TypeDefinition 'using System; using System.Text; using System.Diagnostics; using System.Collections.Generic; using System.Runtime.InteropServices;
public class KujiraFocus {
  public delegate bool Callback(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb, IntPtr p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int n);
  public static IntPtr Find(string processName, string marker) {
    var matches = new List<IntPtr>();
    EnumWindows(delegate(IntPtr h, IntPtr p) {
      if (!IsWindowVisible(h)) return true;
      var title = new StringBuilder(4096); GetWindowText(h, title, title.Capacity);
      if (!title.ToString().Contains(marker)) return true;
      uint id; GetWindowThreadProcessId(h, out id);
      try { if (Process.GetProcessById((int)id).ProcessName == processName) matches.Add(h); } catch { }
      return true;
    }, IntPtr.Zero);
    return matches.Count == 1 ? matches[0] : IntPtr.Zero;
  }
}';
$handle = [KujiraFocus]::Find('${browser[1]}', '${marker}');
if ($handle -eq [IntPtr]::Zero) { Write-Output 'missing'; exit }
if ([KujiraFocus]::IsIconic($handle)) { [KujiraFocus]::ShowWindowAsync($handle,9) | Out-Null }
[KujiraFocus]::SetForegroundWindow($handle) | Out-Null;
for ($i=0; $i -lt 10; $i++) {
  if ([KujiraFocus]::GetForegroundWindow() -eq $handle) { Write-Output 'matched'; exit }
  Start-Sleep -Milliseconds 50;
}
Write-Output 'blocked';`;
      const result = await run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { timeout: 5000, windowsHide: true },
      );
      return result.stdout?.trim() === "matched";
    } else if (platform === "linux" && browser[2]) {
      if (!marker || !env.DISPLAY) return false;
      const result = await run("wmctrl", ["-lx"], { timeout: 2000 });
      const classes = kind === "chrome" ? [browser[2], "chromium", "chromium-browser"] : [browser[2]];
      const matches = (result.stdout || "").split("\n").map((line) => line.trim().split(/\s+/)).filter((fields) =>
        /^0x[0-9a-f]+$/i.test(fields[0]) && fields.slice(4).join(" ").includes(marker) &&
        fields[2]?.toLowerCase().split(".").some((name) => classes.includes(name)));
      if (matches.length !== 1) return false;
      const id = matches[0][0];
      await run("wmctrl", ["-ia", id], { timeout: 2000 });
      for (let attempt = 0; attempt < 6; attempt++) {
        const active = await run("xprop", ["-root", "_NET_ACTIVE_WINDOW"], { timeout: 2000 });
        const activeId = active.stdout?.match(/(?:#|=)\s*(0x[0-9a-f]+)\s*$/i)?.[1];
        if (activeId && BigInt(activeId) === BigInt(id)) return true;
        await wait(100);
      }
      return false;
    } else return false;
    return true;
  } catch (error) {
    console.warn(
      "[kujira] Browser activation failed:",
      error.code,
      error.stderr?.trim() || error.message,
    );
    return false;
  }
}
