import { orbHitRegion, surfaceHitRegion } from "./hit-regions.js";
import { connectPreferencePersistence } from "./preference-persistence.js";
import { captureLocalState, restoreLocalState } from "/dsh-kujira/shared/client/utilities.js";
const { React, ReactDOM } = window;
import {
  createClient,
  prepareClient,
} from "/dsh-kujira/shared/client/index.js";
const api = window.kujiraDesktop;
let nativePosition,
  frame,
  taskSession = null;
const status = await api.status();
let navigationAvailable = !!status.navigationAvailable;
let browserSession = status.browserSessionId;
let browserBackKind = status.browserBackKind;
const syncStatus = (value) => {
  navigationAvailable = !!value.navigationAvailable;
  browserSession = value.browserSessionId;
  browserBackKind = value.browserBackKind;
  if (value.theme === "dark")
    document.body.setAttribute("data-ds-dark-theme", "");
  else document.body.removeAttribute("data-ds-dark-theme");
};
syncStatus(status);
api.onStatus(syncStatus);
document.body.dataset.windowMode = String(status.capabilities.wayland);
const applyPosition = (position) => {
  nativePosition = position;
  const root = document.querySelector(".dsh-kujira-root");
  if (!root) return;
  Object.assign(root.style, {
    left: position.x + "px",
    top: position.y + "px",
    right: "auto",
    bottom: "auto",
  });
  root.style.setProperty("--kj-size", position.size + "px");
  root.dataset.corner = "free";
  window.dispatchEvent(new Event("kujira:position-applied"));
};
api.onPosition(applyPosition);
let menuWasOpen = false,
  menuSettlesAt = 0,
  menuSettleTimer;
const observedSurfaces = new Set();
const surfaceObserver = new ResizeObserver(() => reportRegions());
const reportRegions = () => {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const root = document.querySelector(".dsh-kujira-root");
    const hostRect = document
      .querySelector(".dsh-kujira-orbs")
      ?.getBoundingClientRect();
    // Opening gestures use swept bounds; settled buttons use only their own hit area.
    const orbSize =
      parseFloat(root?.style.getPropertyValue("--kj-orb-size")) || 34;
    const menuOpen = root?.dataset.orb === "1";
    if (menuOpen && !menuWasOpen) {
      const delays = [...document.querySelectorAll(".dsh-kujira-orb")].map(
        (el) => parseFloat(el.style.getPropertyValue("--kj-in-delay")) || 0,
      );
      const duration = Math.min(
        2000,
        Math.max(0, ...delays) +
          (parseFloat(root.style.getPropertyValue("--kj-in-ms")) || 285) +
          50,
      );
      menuSettlesAt = performance.now() + duration;
      clearTimeout(menuSettleTimer);
      menuSettleTimer = setTimeout(reportRegions, duration);
    }
    if (!menuOpen) {
      clearTimeout(menuSettleTimer);
      menuSettlesAt = 0;
    }
    menuWasOpen = menuOpen;
    const isOrb = (el) => el.classList.contains("dsh-kujira-orb");
    const surfaces = [
      ...document.querySelectorAll(
        ".dsh-kujira-stage,.dsh-kujira-panel,.dsh-kujira-orb,.kj-select-list,.kj-tooltip:popover-open,#startup",
      ),
    ];
    for (const el of observedSurfaces) {
      if (surfaces.includes(el)) continue;
      surfaceObserver.unobserve(el);
      observedSurfaces.delete(el);
    }
    let moving = false;
    const rects = surfaces
      .map((el) => {
        if (!observedSurfaces.has(el)) {
          observedSurfaces.add(el);
          surfaceObserver.observe(el);
        }
        if (isOrb(el) && !menuOpen) return null;
        if (isOrb(el) && hostRect) {
          const dx = parseFloat(el.style.getPropertyValue("--kj-dx")) || 0;
          const dy = parseFloat(el.style.getPropertyValue("--kj-dy")) || 0;
          return orbHitRegion(
            hostRect,
            orbSize,
            dx,
            dy,
            performance.now() < menuSettlesAt,
          );
        }
        const surface = surfaceHitRegion(el, getComputedStyle(el));
        moving ||= surface.moving;
        return surface.rect;
      })
      .filter(Boolean);
    api.hitRegions(rects.slice(0, 32));
    // Only finite surface motion requests another frame; idle pets stay event-driven.
    if (moving) reportRegions();
  });
};
const observer = new MutationObserver(reportRegions);
observer.observe(document.body, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: [
    "style",
    "class",
    "hidden",
    "data-panel",
    "data-open",
    "data-orb",
  ],
});
window.addEventListener("resize", reportRegions);
for (const type of [
  "animationstart",
  "animationend",
  "animationcancel",
  "transitionrun",
  "transitionend",
  "transitioncancel",
  "toggle",
])
  document.addEventListener(
    type,
    (event) => {
      if (observedSurfaces.has(event.target)) reportRegions();
    },
    true,
  );
window.addEventListener(
  "pointerdown",
  (event) => {
    if (event.button === 0 && event.target.closest?.(".dsh-kujira-root"))
      api.pointer({ x: event.clientX, y: event.clientY, pressed: true });
  },
  true,
);
for (const type of ["pointerup", "pointercancel"])
  window.addEventListener(
    type,
    (event) =>
      api.pointer({ x: event.clientX, y: event.clientY, pressed: false }),
    true,
  );
let mouseFrame, mousePoint;
window.addEventListener(
  "mousemove",
  (event) => {
    mousePoint = { x: event.clientX, y: event.clientY };
    if (mouseFrame) return;
    mouseFrame = requestAnimationFrame(() => {
      mouseFrame = null;
      api.pointer(mousePoint);
    });
  },
  { passive: true },
);
await connectPreferencePersistence({ api, capture: captureLocalState, restore: restoreLocalState });
await prepareClient();
const client = createClient(React),
  h = React.createElement;
let initial = true;
function Ready() {
  if (nativePosition) applyPosition(nativePosition);
  if (initial) {
    initial = false;
    document.getElementById("startup").textContent = "";
    api.ready().catch(() => {});
  }
}
const navigate = async (target) => {
  const { signal, ...value } = target;
  if (signal?.aborted) return false;
  const result = await api.navigate(value);
  return result?.success === true;
};
navigate.canOpen = (target) =>
  navigationAvailable &&
  (target?.kind === "back"
    ? !!browserBackKind
    : ["session", "file", "message", "child"].includes(target?.kind));
navigate.backTarget = () =>
  browserBackKind ? { kind: browserBackKind } : null;
function App() {
  const [session, setSession] = React.useState(null);
  React.useEffect(() => {
    let alive = true,
      timer;
    const read = async () => {
      try {
        if (document.hidden) return;
        const state = await fetch("/dsh-kujira/state").then((r) => r.json());
        const next = browserSession || state.sessionIds?.[0] || taskSession;
        if (alive && next !== taskSession) {
          taskSession = next;
          setSession(next);
        }
      } catch {
        /* Keep the task store's explicit disconnected state. */
      } finally {
        if (alive) timer = setTimeout(read, 3000);
      }
    };
    read();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  return h(
    React.Fragment,
    null,
    h(client.Pet, { onPlaybackReady: Ready }),
    h(client.TaskBridge, { sessionId: session, navigate }),
  );
}
ReactDOM.createRoot(document.getElementById("pet")).render(h(App));
reportRegions();
