import { createWebNavigation } from "./web-navigation.js";
import { focusBrowser } from "./browser-focus.js";
import { desktopTranslator } from "./translate.js";
import {
  app,
  clipboard,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  shell,
  dialog,
  screen,
  Tray,
  Menu,
  nativeImage,
  powerMonitor,
  nativeTheme,
} from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  createSettings,
  normalizeSettings,
  platformCapabilities,
  localOrigin,
} from "./settings.js";
import { createDshService, shouldReleaseOwnedService } from "./dsh-service.js";
import { createConnection } from "./connection.js";
import { createProtocol } from "./protocol.js";
import { createWindowController } from "./window-controller.js";
import { setStartup } from "./startup.js";
import { createPreferenceFlush, savePreferenceSnapshot } from "./preference-lifecycle.js";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.env.KUJIRA_USER_DATA)
  app.setPath("userData", resolve(process.env.KUJIRA_USER_DATA));
console.info("[kujira] Loading desktop settings");
const store = await createSettings(
  join(app.getPath("userData"), "desktop.json"),
);
const settings = () => store.get().settings;
const runtimeRoot = app.isPackaged
  ? join(process.resourcesPath, "runtime")
  : resolve(desktopRoot, "..");
let translate = (value) => value,
  rebuildTrayMenu = () => {};
const refreshLanguage = async () => {
  const selected = store.get().preferences?.appearance?.locale;
  translate = await desktopTranslator(
    runtimeRoot,
    selected && selected !== "system" ? selected : app.getLocale(),
  );
  rebuildTrayMenu();
};
const capabilities = platformCapabilities(
  process.platform,
  process.env,
  settings().linuxBackend,
);
if (process.platform === "linux" && !capabilities.wayland)
  app.commandLine.appendSwitch("ozone-platform", "x11");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "kujira",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);
let win,
  tray,
  controller,
  connection,
  quitting = false,
  ready = false,
  desktopHidden = store.get().displayMode === "browser",
  lastRevision = -1,
  pendingLink = null,
  service = null,
  browserCount = 0;
console.info("[kujira] Starting native window");
const locked = app.requestSingleInstanceLock();
if (!locked) {
  app.quit();
} else {
  const show = () => {
    desktopHidden = false;
    store.save({ displayMode: "desktop" }).catch(() => console.warn("[kujira] Display mode save failed"));
    if (win) {
      capabilities.wayland ? win.show() : win.showInactive();
      connection?.activate();
    }
  };
  const handleLink = async (value) => {
    try {
      const link = new URL(value);
      if (link.protocol !== "dsh-kujira:" || link.host !== "show") return;
      const source = link.searchParams.get("source");
      if (source && localOrigin(source) !== settings().dshUrl) {
        const answer = await dialog.showMessageBox(win, {
          type: "question",
          buttons: ["保持当前连接", "连接此 DSH"],
          defaultId: 0,
          cancelId: 0,
          message: "切换桌宠的 DSH 连接？",
          detail: localOrigin(source),
        });
        if (answer.response === 1)
          await store.save({
            settings: { ...settings(), dshUrl: localOrigin(source) },
          });
      }
      show();
    } catch {
      console.warn("[kujira] Rejected desktop link");
    }
  };
  app.on("second-instance", (_event, args) => {
    const link = args.find((v) => v.startsWith("dsh-kujira:"));
    if (link) handleLink(link);
    else show();
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (win) handleLink(url);
    else pendingLink = url;
  });
  app.on("activate", show);
  app
    .whenReady()
    .then(async () => {
      console.info("[kujira] Native runtime ready");
      await refreshLanguage();
      if (process.platform === "darwin")
        app.dock?.setIcon(join(desktopRoot, "ui/icon.png"));
      win = new BrowserWindow({
        width: Math.min(820, screen.getPrimaryDisplay().workArea.width),
        height: Math.min(740, screen.getPrimaryDisplay().workArea.height),
        frame: capabilities.wayland,
        transparent: !capabilities.wayland,
        backgroundColor: capabilities.wayland ? "#e5e9fb" : "#00000000",
        show: false,
        acceptFirstMouse: true,
        resizable: capabilities.wayland,
        hasShadow: false,
        skipTaskbar: false,
        title: "Kujira",
        icon: join(desktopRoot, "ui/icon.png"),
        webPreferences: {
          preload: join(desktopRoot, "src/preload.cjs"),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
          backgroundThrottling: true,
        },
      });
      let choosingFile = false;
      win.on("blur", () => {
        controller?.releasePointer();
        if (!choosingFile && !win.isDestroyed())
          win.webContents.send("kujira:dismiss");
      });
      controller = createWindowController({ win, screen, store, capabilities });
      const status = () => ({
        settings: settings(),
        capabilities,
        packaged: app.isPackaged,
        online: connection?.snapshot().online || false,
        needsRestart: connection?.snapshot().legacy || false,
        browserBackKind:
          connection?.snapshot().presence?.browserBackKind || null,
        browserSessionId:
          connection?.snapshot().presence?.browserSessionId || null,
        navigationAvailable:
          connection?.snapshot().presence?.browserCount !== undefined,
        dshOwned: service?.owns(connection?.snapshot()) || false,
        theme: nativeTheme.shouldUseDarkColors ? "dark" : "light",
      });
      const publish = () => {
        if (!win.isDestroyed()) win.webContents.send("kujira:status", status());
      };
      const apply = (previous = {}) => {
        if (
          capabilities.alwaysOnTop &&
          previous.alwaysOnTop !== settings().alwaysOnTop
        )
          win.setAlwaysOnTop(settings().alwaysOnTop, "floating");
        if (
          capabilities.allWorkspaces &&
          previous.allWorkspaces !== settings().allWorkspaces
        )
          win.setVisibleOnAllWorkspaces(settings().allWorkspaces, {
            visibleOnFullScreen: settings().allWorkspaces,
          });
        win.webContents.send("kujira:power", settings().power === "saver");
        publish();
      };
      connection = createConnection({
        getSettings: settings,
        onState: (state) => {
          if (win.isDestroyed()) return;
          const p = state.presence;
          if (p && `${p.instance}:${p.revision}` !== lastRevision) {
            lastRevision = `${p.instance}:${p.revision}`;
            if (p.desired === "desktop") {
              const wasHidden = desktopHidden;
              desktopHidden = false;
              capabilities.wayland ? win.show() : win.showInactive();
              if (wasHidden) connection.activate();
              store.save({ displayMode: "desktop" }).catch(() => console.warn("[kujira] Display mode save failed"));
            }
            if (
              p.desired === "desktop" &&
              p.preferences &&
              p.preferencesRevision === p.revision &&
              store.get().handoff !== lastRevision
            ) {
              const token = lastRevision;
              const { __position, ...shared } = p.preferences;
              const preferences = { ...shared, __position: store.get().preferences?.__position ?? null,
                __updatedAt: Math.max(Date.now(), Number(shared.__updatedAt) || 0, Number(store.get().preferences?.__updatedAt) || 0) + 1 };
              store.save({ preferences, handoff: token }).then(() => {
                if (!win.isDestroyed() && lastRevision === token) win.webContents.send("kujira:preferences", preferences);
              }).catch(() => console.warn("[kujira] Handoff preferences save failed"));
            }
          }
          if (p?.desired === "browser" && p.browserReady && p.desktopActive) {
            win.hide();
            desktopHidden = true;
            store.save({ displayMode: "browser" }).catch(() => console.warn("[kujira] Display mode save failed"));
            connection.standby();
          }
          if (state.online && state.presence) {
            const nextCount = state.presence.browserCount || 0;
            if (shouldReleaseOwnedService(browserCount, nextCount) && service?.owns(state))
              service.stopOwned().then(() => { publish(); rebuildTrayMenu(); }).catch((error) => console.warn("[kujira] Owned DSH stop failed:", error.message));
            browserCount = nextCount;
          }
          publish();
        },
      });
      if (desktopHidden) await connection.standby();
      protocol.handle(
        "kujira",
        createProtocol({
          runtime: app.isPackaged
            ? join(process.resourcesPath, "runtime")
            : resolve(desktopRoot, ".."),
          desktopRoot,
          net,
          connection,
        }),
      );
      win.webContents.session.setPermissionRequestHandler(
        (_wc, _permission, callback) => callback(false),
      );
      const openExternal = async (url) => {
        const parsed = new URL(url);
        if (
          parsed.origin === settings().dshUrl ||
          (parsed.protocol === "https:" && parsed.hostname === "www.npmjs.com" && parsed.pathname === "/package/@deepseek-ai/dsh") ||
          (parsed.protocol === "https:" &&
            parsed.hostname === "github.com" &&
            parsed.pathname.startsWith("/YuluoY/dsh-kujira"))
        )
          await shell.openExternal(url);
      };
      win.webContents.setWindowOpenHandler(({ url }) => {
        openExternal(url).catch(() => {});
        return { action: "deny" };
      });
      win.webContents.on("will-navigate", (event, url) => {
        if (new URL(url).origin !== "kujira://app") {
          event.preventDefault();
          openExternal(url).catch(() => {});
        }
      });
      service = createDshService({
        getSettings: settings,
        openUrl: (url) => shell.openExternal(url),
        ownershipFile: join(app.getPath("userData"), "dsh-owned.json"),
      });
      await service.ready;
      const trusted = (event) =>
        event.sender === win.webContents &&
        event.senderFrame?.url?.startsWith("kujira://app/");
      const handle = (name, fn) =>
        ipcMain.handle("kujira:" + name, async (event, ...args) => {
          if (!trusted(event)) throw Error("untrusted-sender");
          return fn(...args);
        });
      handle("status", status);
      handle("read-preferences", async () => { await store.flush(); return store.get().preferences || null; });
      const preferenceFlush = createPreferenceFlush({ send: (id) => win.webContents.send("kujira:flush-preferences", id) });
      ipcMain.on("kujira:preferences-flushed", (event, id) => { if (trusted(event)) preferenceFlush.acknowledge(id); });
      handle("save-preferences", async (value) => {
        const previousLocale = store.get().preferences?.appearance?.locale;
        if (!await savePreferenceSnapshot(store, value)) return;
        if (previousLocale !== value.appearance?.locale)
          await refreshLanguage();
      });
      handle("configure", async (patch) => {
        if (!patch || typeof patch !== "object" || Array.isArray(patch))
          throw Error("invalid-settings");
        if ("executable" in patch) throw Error("use-file-picker");
        const previous = settings();
        const next = normalizeSettings({ ...previous, ...patch }, {strict:true});
        if (
          next.dshUrl !== settings().dshUrl ||
          next.profile !== settings().profile
        ) {
          await connection.reset();
          lastRevision = -1;
        }
        if (next.login !== settings().login) await setStartup(app, next.login);
        await store.save({ settings: next });
        apply(previous);
        if (next.display !== previous.display) controller.place();
        if (
          next.dshUrl !== previous.dshUrl ||
          next.profile !== previous.profile
        ) {
          await service.stopOwned();
          connection.tick();
          rebuildTrayMenu();
        }
        return status();
      });
      handle("copy-session-id", (id) => {
        if(typeof id !== "string" || !id || id.length > 512 || /[\r\n\0]/.test(id))throw Error("invalid-session-id");
        clipboard.writeText(id);
        return true;
      });
      const navigateWeb = createWebNavigation({
        connection, service,
        focus: (browser, focusToken) => focusBrowser(browser, process.platform, undefined, settings().dshUrl, { focusToken }),
      });
      let webRequest;
      const openWeb = () =>
        (webRequest ||= navigateWeb({ kind: "web" }).finally(() => {
          webRequest = null;
        }));
      handle("navigate", navigateWeb);
      handle("open-dsh", async () => {
        if (!(await openWeb()).success) throw Error("web-navigation-timeout");
        return status();
      });
      handle("browser", async () => {
        await preferenceFlush.flush();
        if (!(await openWeb()).success) throw Error("web-navigation-timeout");
        await connection.toBrowser(store.get().preferences);
        return status();
      });
      handle("choose-executable", async () => {
        choosingFile = true;
        let result;
        try {
          result = await dialog.showOpenDialog(win, {
            title: "选择 DSH 程序",
            properties: ["openFile"],
          });
        } finally {
          choosingFile = false;
        }
        if (!result.canceled) {
          await store.save({
            settings: normalizeSettings({
              ...settings(),
              executable: result.filePaths[0],
            }),
          });
        }
        return status();
      });
      handle("reset-position", () => controller.place(undefined, true));
      handle("hide", () => {
        desktopHidden = true;
        win.hide();
      });
      const confirmStop = async () => {
        const answer = await dialog.showMessageBox(win, {
          type: "question",
          buttons: [translate("取消"), translate("关闭服务")],
          defaultId: 0,
          cancelId: 0,
          message: translate("关闭桌宠启动的 DSH"),
          detail: translate("会结束桌宠拉起的 DSH，正在进行的任务会中断。你自己打开的服务不会被结束。"),
        });
        if (answer.response !== 1) return status();
        await service.stopOwned();
        publish();
        rebuildTrayMenu();
        return status();
      };
      handle("stop-dsh", confirmStop);
      handle("quit", () => app.quit());
      handle("ready", async () => {
        ready = true;
        controller.place();
        apply();
        if (!desktopHidden)
          capabilities.wayland ? win.show() : win.showInactive();
        await connection.setReady();
        return status();
      });
      for (const [name, callback] of Object.entries({
        place: controller.place,
        pointer: controller.pointer,
        "drag-start": controller.start,
        "drag-move": controller.move,
        "drag-end": controller.end,
        "hit-regions": controller.regions,
      }))
        ipcMain.on("kujira:" + name, (event, value) => {
          if (trusted(event)) callback(value);
        });
      const menuAction = (fn) => () =>
        Promise.resolve(fn()).catch((error) =>
          dialog.showMessageBox(win, {
            type: "error",
            message: translate("操作未完成"),
            detail: translate(error.message),
          }),
        );
      tray = new Tray(
        nativeImage.createFromPath(join(desktopRoot, "ui/tray.png")),
      );
      tray.setToolTip("Kujira");
      rebuildTrayMenu = () => {
        if (!tray || tray.isDestroyed()) return;
        tray.setContextMenu(Menu.buildFromTemplate([
          { label: translate("显示人物"), click: show },
          { label: translate("打开 DSH"), click: menuAction(openWeb) },
          ...(service?.owns(connection?.snapshot()) ? [{
            label: translate("关闭桌宠启动的 DSH"),
            click: menuAction(confirmStop),
          }] : []),
          {
            label: translate("设置"),
            click: () => {
              show();
              win.webContents.send("kujira:panel", "settings");
              win.focus();
            },
          },
          {
            label: translate("人物归位"),
            click: () => {
              show();
              controller.place(undefined, true);
            },
          },
          { type: "separator" },
          {
            label: translate("隐藏人物"),
            click: () => {
              desktopHidden = true;
              win.hide();
            },
          },
          { label: translate("退出桌宠（保留 DSH）"), click: () => app.quit() },
        ]));
      };
      rebuildTrayMenu();
      tray.on("click", show);
      win.on("close", (event) => {
        if (!quitting && settings().closeAction === "hide") {
          event.preventDefault();
          desktopHidden = true;
          win.hide();
        } else if (!quitting) {
          event.preventDefault();
          app.quit();
        }
      });
      win.webContents.on("render-process-gone", () => {
        ready = false;
        connection.dispose();
        dialog.showMessageBox({
          type: "error",
          message: "桌宠窗口已停止，请重新打开应用。DSH 任务不受影响。",
        });
        app.quit();
      });
      powerMonitor.on("lock-screen", () => win.hide());
      powerMonitor.on("suspend", () => win.hide());
      const resume = () => {
        if (ready && !desktopHidden) {
          capabilities.wayland ? win.show() : win.showInactive();
          connection.tick();
          controller.place();
        }
      };
      powerMonitor.on("unlock-screen", resume);
      powerMonitor.on("resume", resume);
      nativeTheme.on("updated", publish);
      if (app.isPackaged) app.setAsDefaultProtocolClient("dsh-kujira");
      console.info("[kujira] Loading local companion");
      await win.loadURL("kujira://app/index.html");
      console.info("[kujira] Companion document loaded");
      connection.tick();
      const startLink =
        pendingLink || process.argv.find((v) => v.startsWith("dsh-kujira:"));
      if (startLink) await handleLink(startLink);
      app.on("before-quit", (event) => {
        if (quitting) return;
        event.preventDefault();
        quitting = true;
        controller.dispose();
        preferenceFlush.flush().then(() => Promise.allSettled([connection.dispose(), store.flush()])).finally(
          () => {
            tray?.destroy();
            app.quit();
          },
        );
      });
      app.on("window-all-closed", () => app.quit());
    })
    .catch((error) => {
      console.error("[kujira] Desktop startup failed:", error);
      app.quit();
    });
}
