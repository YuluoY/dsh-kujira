import { animationAnchor, fitBubble } from "./bubble-geometry.js";
import { panelGeometry } from "./panel-geometry.js";
import { menuButtonSize } from "./utilities.js";
/**
 * @description Anchor bubbles and panels to the mascot during drag and viewport changes.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function usePetLayout({
  useEffect,
  setViewportTick,
  useLayoutEffect,
  rootRef,
  ARCRef,
  liveViewport,
  cfgRef,
  currentRef,
  clamp,
  bubbleOutline,
  fitSurfacesRef,
  useCallback,
  prefsRef,
  readStore,
  POS_KEY,
  writeStore,
}) {
  useEffect(() => {
    const onResize = () => setViewportTick((n) => n + 1);

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let surface = root.querySelector(".dsh-kujira-panel");
    let speech = root.querySelector(".dsh-kujira-bubble");
    const fit = () => {
      const rect = root.getBoundingClientRect();
      if (surface && ARCRef.current) {
        const compact = window.innerWidth <= 600;
        const inset = Math.min(36, rect.width * 0.14);
        const placement = ARCRef.current.panelPlacement({
          rect: {
            left: rect.left + inset,
            right: rect.right - inset,
            width: rect.width - inset * 2,
          },
          viewport: liveViewport(),
          side: cfgRef.current.ui.buttonSide === "right" ? -1 : 1,
          wantW: 320,
          minW: 272,
        });
        root.style.setProperty("--kj-panel-w", placement.width + "px");
        root.style.setProperty("--kj-panel-in", placement.pull + inset + "px");
        root.dataset.btns = placement.side > 0 ? "left" : "right";
        const viewport = liveViewport();
        surface.style.maxHeight =
          panelGeometry(rect, viewport, 520).maxHeight + "px";
        const { top, maxHeight } = panelGeometry(
          rect,
          viewport,
          surface.offsetHeight,
        );
        surface.style.top = (compact ? top : top - rect.top) + "px";
        surface.style.bottom = "auto";
        surface.style.maxHeight = maxHeight + "px";
        const height = surface.offsetHeight,
          width = surface.offsetWidth;
        const y = clamp(
          rect.top + rect.height * 0.5 - top,
          38,
          Math.max(38, height - 38),
        );
        surface.style.setProperty("--kj-anchor-y", y + "px");
        const shell = surface.querySelector(".kj-shell");
        if (shell) {
          const path = shell.querySelector("path");

          shell.setAttribute(
            "viewBox",
            "-12 -1 " + (width + 24) + " " + (height + 2),
          );
          path.setAttribute("d", bubbleOutline(width, height, y, !compact));
          path.setAttribute(
            "transform",
            placement.side < 0 ? `translate(${width} 0) scale(-1 1)` : "",
          );
        }
      }
      if (speech) {
        const anchor = speech.classList.contains("kj-thought-bubble")
          ? animationAnchor(
              rect,
              cfgRef.current.animationAnchors?.[currentRef?.current],
            )
          : rect;
        fitBubble(speech, anchor, liveViewport(), bubbleOutline);
      }
    };
    fitSurfacesRef.current = fit;
    fit();
    let resizeFrame;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(fit);
    });
    observer.observe(root);
    if (surface) observer.observe(surface);
    if (speech) observer.observe(speech);
    const mutation = new MutationObserver(() => {
      const nextSurface = root.querySelector(".dsh-kujira-panel"),
        nextSpeech = root.querySelector(".dsh-kujira-bubble");
      if (nextSurface === surface && nextSpeech === speech) return;
      if (surface) observer.unobserve(surface);
      if (speech) observer.unobserve(speech);
      surface = nextSurface;
      speech = nextSpeech;
      if (surface) observer.observe(surface);
      if (speech) observer.observe(speech);
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(fit);
    });
    mutation.observe(root, { childList: true, subtree: true });
    window.addEventListener("resize", fit);
    window.addEventListener("kujira:position-applied", fit);
    return () => {
      observer.disconnect();
      mutation.disconnect();
      cancelAnimationFrame(resizeFrame);
      window.removeEventListener("resize", fit);
      window.removeEventListener("kujira:position-applied", fit);
    };
  }, []);
  const moveTo = useCallback((x, y) => {
    const el = rootRef.current;
    if (!el) {
      return;
    }
    el.dataset.corner = "free";
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
    fitSurfacesRef.current?.();
  }, []);
  const applyVisual = useCallback(() => {
    const el = rootRef.current;
    const cfg = cfgRef.current;
    if (!el) {
      return;
    }
    cfg.size = clamp(Number(prefsRef.current.size) || cfg.size, 120, 360);
    const previous = el.getBoundingClientRect();
    const positioned =
      globalThis.kujiraDesktop && document.body.dataset.windowMode !== "true";
    if (!positioned) el.style.setProperty("--kj-size", cfg.size + "px");
    const buttonSize = menuButtonSize(prefsRef.current, cfg.size);
    el.style.setProperty("--kj-orb-size", buttonSize + "px");
    el.style.setProperty("--kj-orb-icon", Math.round(buttonSize / 2) + "px");
    el.style.setProperty("--kj-ox", cfg.offset.x + "px");
    el.style.setProperty("--kj-oy", cfg.offset.y + "px");
    el.dataset.facing = cfg.facing;

    if (positioned) {
      if (el.dataset.requestedSize !== String(cfg.size)) {
        el.dataset.requestedSize = String(cfg.size);
        globalThis.kujiraDesktop.place(cfg.size);
      }
      return;
    }
    const saved = readStore(POS_KEY);
    if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
      let { x, y } = saved;
      if (el.dataset.visualReady && previous.width !== cfg.size) {
        const delta = previous.width - cfg.size;
        const right = window.innerWidth - previous.right;
        x =
          previous.left +
          (previous.left <= 32 ? 0 : right <= 32 ? delta : delta / 2);
        y = previous.top + (previous.top <= 32 ? 0 : delta);
        x = clamp(x, 0, Math.max(0, window.innerWidth - cfg.size));
        y = clamp(y, 0, Math.max(0, window.innerHeight - cfg.size));
        writeStore(POS_KEY, { x, y });
      }
      moveTo(x, y);
    } else {
      el.dataset.corner = cfg.corner;
    }
    el.dataset.visualReady = "1";
    fitSurfacesRef.current?.();
  }, [moveTo]);
  useEffect(() => {
    const onResize = () => {
      if (
        globalThis.kujiraDesktop &&
        document.body.dataset.windowMode !== "true"
      )
        return;
      const el = rootRef.current;
      if (!el || el.dataset.corner !== "free") {
        return;
      }
      const r = el.getBoundingClientRect();
      const x = clamp(r.left, 0, Math.max(0, window.innerWidth - r.width));
      const y = clamp(r.top, 0, Math.max(0, window.innerHeight - r.height));
      moveTo(x, y);
      writeStore(POS_KEY, { x: Math.round(x), y: Math.round(y) });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [moveTo]);
  return { moveTo, applyVisual };
}
