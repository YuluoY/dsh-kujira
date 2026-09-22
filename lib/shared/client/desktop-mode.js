import { captureLocalState, restoreLocalState, readLocalState, writeLocalState } from "./utilities.js";

/**
 * @description Apply each explicit browser handoff once across remounts and DSH restarts.
 * @param {object} presence Current host presence snapshot.
 * @param {object} storage Browser storage adapter.
 * @returns {boolean} Whether a new handoff was restored.
 */
export function restoreBrowserHandoff(presence, storage) {
  if (presence?.desired !== "browser" || !presence.preferences || !presence.instance ||
    presence.preferencesRevision !== presence.revision) return false;
  const token = `${presence.instance}:${presence.revision}`;
  if (readLocalState("dsh-kujira:handoff", storage) === token) return false;
  if (!restoreLocalState(presence.preferences, { storage, preservePosition: true })) return false;
  writeLocalState("dsh-kujira:handoff", token, storage);
  return true;
}
/**
 * @description Request an acknowledged display handoff without hiding the current pet early.
 */
export async function requestDesktopMode(mode) {
  const response = await fetch("/dsh-kujira/desktop", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Kujira-Desktop": "1" },
    body: JSON.stringify({
      action: "request",
      mode,
      preferences: captureLocalState(),
    }),
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw Error("desktop-unavailable");
  return response.json();
}

/**
 * @description Mount only the selected browser pet and restore it when the desktop lease expires.
 */
export function createBrowserPet(React, Pet) {
  return function BrowserPet() {
    const [presence, setPresence] = React.useState(null);
    const presenceRef = React.useRef(null);
    React.useEffect(() => {
      let alive = true,
        reading = false,
        timer,
        controller;
      const read = async () => {
        clearTimeout(timer);
        if (reading) return;
        if (document.hidden) {
          timer = setTimeout(read, 5000);
          return;
        }
        reading = true;
        controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        try {
          const response = await fetch("/dsh-kujira/desktop", {
            signal: controller.signal,
          });
          if (!response.ok) throw Error();
          const next = await response.json();
          if (alive) {
            restoreBrowserHandoff(next);
            presenceRef.current = next;
            setPresence((old) =>
              old?.desktopActive === next.desktopActive &&
              old?.desired === next.desired &&
              old?.revision === next.revision
                ? old
                : next,
            );
          }
        } catch {
          if (alive) {
            presenceRef.current = null;
            setPresence(null);
          }
        } finally {
          reading = false;
          clearTimeout(timeout);
          if (alive) timer = setTimeout(read, 5000);
        }
      };
      read();
      document.addEventListener("visibilitychange", read);
      return () => {
        alive = false;
        clearTimeout(timer);
        controller?.abort();
        document.removeEventListener("visibilitychange", read);
      };
    }, []);
    const onPlaybackReady = React.useCallback(() => {
      const current = presenceRef.current;
      if (current?.desired !== "browser" || current.browserReady) return;
      fetch("/dsh-kujira/desktop", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Kujira-Desktop": "1",
        },
        body: JSON.stringify({
          action: "browser-ready",
          revision: current.revision,
        }),
      }).catch(() => {});
    }, []);
    if (presence?.desktopActive && presence.desired === "desktop") return null;
    return React.createElement(Pet, { onPlaybackReady });
  };
}

/**
 * @description Receive explicit desktop navigation in one registered DSH tab.
 */
export function connectBrowserNavigation(
  navigate,
  getSession = () => null,
  getBackKind = () => null,
) {
  const client = crypto.randomUUID();
  const ua = navigator.userAgent;
  const browser = /Electron/.test(ua)
    ? "codex"
    : /Edg\//.test(ua)
      ? "edge"
      : /Firefox\//.test(ua)
        ? "firefox"
        : /Chrome\//.test(ua)
          ? "chrome"
          : /Safari\//.test(ua)
            ? "safari"
            : "";
  let stopped = false,
    timer,
    controller,
    last = "";
  let clearMarker = () => {};
  const post = async (body) => {
    const response = await fetch("/dsh-kujira/desktop", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Kujira-Desktop": "1" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]),
    });
    if (!response.ok) throw Error("desktop-unavailable");
    return response.json();
  };
  const read = async () => {
    controller = new AbortController();
    try {
      const value = await post({
        action: "browser-poll",
        client,
        visible: !document.hidden,
        browser,
        sessionId: getSession(),
        backKind: getBackKind(),
      });
      const command = value.navigation;
      if (value.focusReleased === last) clearMarker();
      if (!stopped && command && command.id !== last) {
        last = command.id;
        window.focus();
        let success = command.target.kind === "web";
        try {
          if (!success) success = await navigate(command.target);
        } catch {
          success = false;
        }
        if (!stopped) {
          clearMarker();
          if (success) clearMarker = markNavigationTitle(command.id);
          await post({
            action: "navigation-ack",
            client,
            id: command.id,
            success,
            focusToken: success ? command.id : null,
            focused: !document.hidden && document.hasFocus(),
          });
        }
      }
    } catch {
      /* A running legacy host can load this bridge after its next restart. */
    } finally {
      if (!stopped) timer = setTimeout(read, 2000);
    }
  };
  const unregister = () =>
    fetch("/dsh-kujira/desktop", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Kujira-Desktop": "1" },
      body: JSON.stringify({ action: "browser-close", client }),
      keepalive: true,
    }).catch(() => {});
  window.addEventListener("pagehide", unregister);
  read();
  return () => {
    window.removeEventListener("pagehide", unregister);
    unregister();
    stopped = true;
    clearMarker();
    clearTimeout(timer);
    controller?.abort();
  };
}

/**
 * @description Temporarily identify the acknowledged tab while preserving later host title changes.
 * @param {string} id Navigation UUID supplied by the local host.
 * @param {object} options Document, observer and timer adapters.
 * @returns {Function} Idempotent title cleanup.
 */
export function markNavigationTitle(id, { doc = document, Observer = MutationObserver,
  schedule = setTimeout, cancel = clearTimeout } = {}) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return () => {};
  const prefix = `[Kujira:${id}] `;
  const mark = () => { if (!doc.title.startsWith(prefix)) doc.title = prefix + doc.title; };
  mark();
  const observer = new Observer(mark);
  observer.observe(doc.head, { childList: true, subtree: true, characterData: true });
  let timer;
  const clear = () => {
    cancel(timer);
    observer.disconnect();
    if (doc.title.startsWith(prefix)) doc.title = doc.title.slice(prefix.length);
  };
  timer = schedule(clear, 15000);
  return clear;
}
