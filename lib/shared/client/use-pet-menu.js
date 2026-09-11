/**
 * @description Control radial menu geometry, pagination and feature-panel navigation.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function usePetMenu({
  useCallback,
  cfgRef,
  clamp,
  prefsRef,
  ARCRef,
  layoutFor,
  liveViewport,
  visibleCountRef,
  rootRef,
  LABEL_GAP,
  orbGeomRef,
  setOrbOpen,
  setViewportTick,
  useLayoutEffect,
  orbOpen,
  prefs,
  pageTimerRef,
  pageRef,
  setPage,
  setPanel,
  panel,
  FEATURE_REGISTRY,
  useEffect,
  ready,
  readStore,
  HINT_KEY,
  writeStore,
  speak,
  lastPanelRef,
  loadBalance,
  loadWeather,
  refreshInventory,
  loadGrowth,
  play,
  busyRef,
}) {
  const openOrb = useCallback(() => {
    const cfg = cfgRef.current;
    cfg.size = clamp(Number(prefsRef.current.size) || cfg.size, 120, 360);
    const ARC = ARCRef.current;
    const arc = cfg.ui.arc;
    const side = cfg.ui.buttonSide === "right" ? -1 : 1;

    const orbR = layoutFor(cfg, liveViewport(), ARC);

    const count = Math.max(1, visibleCountRef.current || 0);

    const stepDeg = Number(arc.stepDeg) > 0 ? Number(arc.stepDeg) : 24;
    const maxSpan = Number(arc.spanDeg) > 0 ? Number(arc.spanDeg) : 96;
    const minStep =
      (2 *
        Math.asin(
          Math.min(
            0.95,
            (Math.max(44, clamp((cfg.size * 34) / 260, 24, 48)) + 6) /
              (2 * orbR),
          ),
        ) *
        180) /
      Math.PI;
    const spanDeg = Math.max(
      (count - 1) * minStep,
      ARC
        ? ARC.spanForCount({ count, stepDeg, maxSpanDeg: maxSpan })
        : Math.min((count - 1) * stepDeg, maxSpan),
    );

    const explicitDeg =
      arc.centerDeg == null ? Number.NaN : Number(arc.centerDeg);
    let centerDeg = explicitDeg;
    const el = rootRef.current;

    const box = el ? el.getBoundingClientRect() : null;

    if (!Number.isFinite(centerDeg)) {
      if (ARC && box) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const probe =
          side > 0
            ? box
            : {
                left: vw - box.right,
                top: box.top,
                width: box.width,
                height: box.height,
              };

        centerDeg = ARC.pickArcCenter({
          rect: probe,
          spanDeg,
          radius: orbR,
          vw,
          vh,
        }).centerDeg;
      } else {
        centerDeg = 135;
      }
    }

    const slots = ARC
      ? ARC.arcSlots({ count, centerDeg, spanDeg, radius: orbR })
      : [];

    const k = LABEL_GAP / (orbR || 1);

    const placement =
      ARC && box
        ? ARC.panelPlacement({ rect: box, viewport: liveViewport(), side })
        : null;

    orbGeomRef.current = {
      placement,
      orbR,
      slots: slots.map((s) => ({ x: s.x, y: s.y })),
      labels: slots.map((s) => ({ x: s.x * k, y: s.y * k })),
      inDelays: ARC
        ? ARC.staggerDelays({ count, staggerMs: arc.staggerMs, dir: "in" })
        : [],
      outDelays: ARC
        ? ARC.staggerDelays({ count, staggerMs: arc.outStaggerMs, dir: "out" })
        : [],
    };

    setOrbOpen(true);
    setViewportTick((value) => value + 1);
  }, []);
  useLayoutEffect(() => {
    if (orbOpen) openOrb();
  }, [
    prefs.size,
    prefs.menuLimit,
    prefs.showGitHub,
    FEATURE_REGISTRY.length,
    openOrb,
  ]);
  const closeOrb = useCallback(() => {
    const root = rootRef.current;
    if (root?.contains(document.activeElement))
      root.querySelector(".dsh-kujira-stage")?.focus({ preventScroll: true });
    clearTimeout(pageTimerRef.current);
    pageTimerRef.current = 0;
    pageRef.current = 0;
    setPage(0);
    setOrbOpen(false);
    setPanel(null);
  }, []);
  const toggleOrb = useCallback(() => {
    if (panel) {
      setPanel(null);
      openOrb();
      return;
    }

    if (orbOpen) {
      closeOrb();
    } else {
      openOrb();
    }
  }, [panel, orbOpen, openOrb, closeOrb]);
  const cyclePage = useCallback(() => {
    const cfg = cfgRef.current;
    const ARC = ARCRef.current;
    const size =
      Number(cfg.ui.arc.pageSize) > 1
        ? Math.floor(Number(cfg.ui.arc.pageSize))
        : 5;
    const pages = ARC
      ? ARC.sliceArcPage({
          total: FEATURE_REGISTRY.length,
          page: 0,
          pageSize: size,
        }).pageCount
      : 1;
    const next = (pageRef.current + 1) % pages;

    pageRef.current = next;
    setPage(next);
    setOrbOpen(false);

    clearTimeout(pageTimerRef.current);
    pageTimerRef.current = 0;
    pageTimerRef.current = setTimeout(() => {
      pageTimerRef.current = 0;
      openOrb();
    }, 70);
  }, [openOrb, FEATURE_REGISTRY]);
  useEffect(() => {
    if (!orbOpen && !panel) {
      return undefined;
    }

    const onKey = (e) => {
      if (e.key === "Escape") {
        setPanel(null);
        closeOrb();
      }
    };

    const onDown = (e) => {
      const el = rootRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        setPanel(null);
        closeOrb();
      }
    };

    document.addEventListener("keydown", onKey);

    document.addEventListener("pointerdown", onDown, true);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [orbOpen, panel, closeOrb]);
  useEffect(() => {
    if (!ready) {
      return undefined;
    }

    const cfg = cfgRef.current;
    if (!cfg.ui.buttons || !cfg.ui.arc.hintOnce || readStore(HINT_KEY)) {
      return undefined;
    }

    const show = setTimeout(() => {
      writeStore(HINT_KEY, true);
      speak("点我一下，能打开功能菜单");
    }, 4200);

    return () => clearTimeout(show);
  }, [ready, speak]);
  useEffect(() => () => clearTimeout(pageTimerRef.current), []);
  const togglePanel = useCallback(
    (which) => {
      clearTimeout(pageTimerRef.current);
      pageTimerRef.current = 0;
      const next = panel === which ? null : which;

      if (next) {
        lastPanelRef.current = next;
      }

      pageRef.current = 0;
      setPage(0);
      setOrbOpen(false);
      setPanel(next);

      if (next === "balance") {
        if (!busyRef.current) play("翻钱包", { loop: false });
        loadBalance(false);
      }
      if (next === "weather") {
        if (!busyRef.current) play("看天气", { loop: false });
        loadWeather(false);
      }
      if (next === "growth") {
        refreshInventory();
        loadGrowth();
      }
    },
    [panel, loadBalance, loadWeather, loadGrowth, refreshInventory],
  );
  const backToMenu = useCallback(() => {
    setPanel(null);
    openOrb();
  }, [openOrb]);
  return { closeOrb, toggleOrb, cyclePage, togglePanel, backToMenu };
}
