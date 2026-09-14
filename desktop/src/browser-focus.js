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
 */
export async function focusBrowser(
  kind,
  platform = process.platform,
  run = execute,
  origin,
) {
  const browser = browsers[kind];
  if (!browser) return false;
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
        if(url===origin || url.indexOf(origin+"/")===0) {
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
          ["-l", "JavaScript", "-e", script, origin, browser[0], kind],
          { timeout: 10000 },
        );
        console.info("[kujira] Existing browser tab:", result.stdout?.trim());
        return result.stdout?.trim() === "matched";
      }
      await run("/usr/bin/open", ["-b", browser[0]], { timeout: 2000 });
    } else if (platform === "win32" && browser[1]) {
      const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class KujiraFocus { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int n); }'; $p = Get-Process -Name '${browser[1]}' -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object -First 1; if ($p) { [KujiraFocus]::ShowWindowAsync($p.MainWindowHandle,9) | Out-Null; [KujiraFocus]::SetForegroundWindow($p.MainWindowHandle) | Out-Null }`;
      await run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { timeout: 3000, windowsHide: true },
      );
    } else if (platform === "linux" && browser[2]) {
      await run("wmctrl", ["-xa", browser[2]], { timeout: 2000 });
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
