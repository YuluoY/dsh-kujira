import { panelGeometry } from "./panel-geometry.js";
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
  clamp,
  bubbleOutline,
  dragRef,
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
    const surface = root.querySelector(".dsh-kujira-panel");
    const speech = root.querySelector(".dsh-kujira-bubble");
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
        const { top, maxHeight } = panelGeometry(
          rect,
          liveViewport(),
          surface.dataset.panel === "settings" ? 360 : 260,
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
        const mouthY = rect.top + rect.height * 0.55;
        const leftAnchor = rect.left + rect.width * 0.3;
        const rightAnchor = rect.right - rect.width * 0.3;
        const leftRoom = leftAnchor,
          rightRoom = window.innerWidth - rightAnchor;
        const left =
          dragRef.current?.moved && speech.dataset.side
            ? speech.dataset.side === "left"
            : leftRoom >= rightRoom;
        speech.dataset.side = left ? "left" : "right";
        speech.style.maxWidth =
          Math.min(
            208,
            Math.max(120, Math.max(leftRoom, rightRoom) - 24),
            window.innerWidth - 24,
          ) + "px";
        const width = speech.offsetWidth,
          height = speech.offsetHeight;
        const x = clamp(
          left ? leftAnchor - width - 14 : rightAnchor + 14,
          12,
          window.innerWidth - width - 12,
        );
        const y = clamp(
          mouthY - height - 24,
          12,
          window.innerHeight - height - 12,
        );
        speech.style.left = x + "px";
        speech.style.top = y + "px";
        const shell = speech.querySelector(".kj-shell");
        if (shell && bubbleOutline) {
          shell.setAttribute(
            "viewBox",
            "-12 -1 " + (width + 24) + " " + (height + 2),
          );
          shell
            .querySelector("path")
            .setAttribute(
              "d",
              bubbleOutline(width, height, height - 16, true, true),
            );
          shell
            .querySelector("path")
            .setAttribute(
              "transform",
              left ? "" : `translate(${width} 0) scale(-1 1)`,
            );
        }
      }
    };
    fitSurfacesRef.current = fit;
    fit();
    const observer = new ResizeObserver(fit);
    if (surface) observer.observe(surface);
    if (speech) observer.observe(speech);
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  });
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
    el.style.setProperty("--kj-size", cfg.size + "px");
    el.style.setProperty(
      "--kj-orb-size",
      clamp((cfg.size * 34) / 260, 24, 48) + "px",
    );
    el.style.setProperty(
      "--kj-orb-icon",
      clamp((cfg.size * 17) / 260, 12, 24) + "px",
    );
    el.style.setProperty("--kj-ox", cfg.offset.x + "px");
    el.style.setProperty("--kj-oy", cfg.offset.y + "px");
    el.dataset.facing = cfg.facing;

    const saved = readStore(POS_KEY);
    if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
      moveTo(saved.x, saved.y);
    } else {
      el.dataset.corner = cfg.corner;
    }
  }, [moveTo]);
  useEffect(() => {
    const onResize = () => {
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
