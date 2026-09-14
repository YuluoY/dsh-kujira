const { contextBridge, ipcRenderer } = require("electron");
const invoke = (name, ...args) => ipcRenderer.invoke("kujira:" + name, ...args);
const subscribe = (name, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on("kujira:" + name, listener);
  return () => ipcRenderer.removeListener("kujira:" + name, listener);
};
contextBridge.exposeInMainWorld(
  "kujiraDesktop",
  Object.freeze({
    status: () => invoke("status"),
    savePreferences: (value) => invoke("save-preferences", value),
    configure: (patch) => invoke("configure", patch),
    copySessionId: (id) => invoke("copy-session-id", id),
    navigate: (target) => invoke("navigate", target),
    openDsh: () => invoke("open-dsh"),
    browser: () => invoke("browser"),
    chooseExecutable: () => invoke("choose-executable"),
    resetPosition: () => invoke("reset-position"),
    hide: () => invoke("hide"),
    quit: () => invoke("quit"),
    ready: () => invoke("ready"),
    place: (size) => ipcRenderer.send("kujira:place", size),
    dragStart: (rect) => ipcRenderer.send("kujira:drag-start", rect),
    dragMove: () => ipcRenderer.send("kujira:drag-move"),
    dragEnd: () => ipcRenderer.send("kujira:drag-end"),
    pointer: (point) => ipcRenderer.send("kujira:pointer", point),
    hitRegions: (regions) => ipcRenderer.send("kujira:hit-regions", regions),
    onStatus: (fn) => subscribe("status", fn),
    onPosition: (fn) => subscribe("position", fn),
    onPower: (fn) => subscribe("power", fn),
    onPreferences: (fn) => subscribe("preferences", fn),
    onDismiss: (fn) => subscribe("dismiss", fn),
    onPanel: (fn) => subscribe("panel", fn),
  }),
);
