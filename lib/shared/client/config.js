/**
 * @description Define persisted keys, behavior defaults and configuration normalization.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function createConfig({ clamp }) {
  const ASSET_BASE = "/dsh-kujira";
  const POS_KEY = "dsh-kujira:position";
  const SET_KEY = "dsh-kujira:settings";
  const GROW_KEY = "dsh-kujira:growth";
  const HINT_KEY = "dsh-kujira:hint";
  const DRAG_THRESHOLD = 6;
  const DEFAULT_POLL_MS = 1500;
  const IDLE = "idle";
  const DEFAULTS = {
    size: 260,
    corner: "bottom-right",
    offset: { x: 24, y: 0 },
    facing: "left",
    startAnim: "待机呼吸休闲",
    gapMs: [1200, 3600],
    weights: { idle: 0.5, action: 0.4, long: 0.1 },
    pools: { idle: [], action: [], long: [], click: [], drag: "" },
    dragAnim: "",
    state: { enabled: true, pollMs: DEFAULT_POLL_MS, map: {}, enter: {} },
    ui: {
      buttons: true,
      bubble: true,
      showLabel: false,
      buttonSide: "left",
      arc: {
        radius: 0,

        spanDeg: 96,
        stepDeg: 24,

        pageSize: 5,
        centerDeg: null,
        staggerMs: 32,
        enterMs: 285,
        fadeMs: 155,
        exitMs: 190,
        outStaggerMs: 24,
        labels: true,
        hintOnce: true,
      },
    },
    growth: { enabled: true },
    care: {
      greetBack: true,
      longSit: true,
      longSitMs: 25 * 60 * 1000,
      minGapMs: 15 * 60 * 1000,
      backAfterMs: 3 * 60 * 1000,
    },
    debug: { showLabel: false },
  };
  const LABEL_GAP = 34;
  function normalizeConfig(raw) {
    const cfg = Object.assign({}, DEFAULTS, raw || {});
    cfg.pools = Object.assign({}, DEFAULTS.pools, cfg.pools || {});
    cfg.weights = Object.assign({}, DEFAULTS.weights, cfg.weights || {});
    cfg.offset = Object.assign({}, DEFAULTS.offset, cfg.offset || {});
    cfg.debug = Object.assign({}, DEFAULTS.debug, cfg.debug || {});
    cfg.state = Object.assign({}, DEFAULTS.state, cfg.state || {});
    cfg.state.map = Object.assign({}, cfg.state.map || {});
    cfg.state.enter = Object.assign({}, cfg.state.enter || {});
    cfg.ui = Object.assign({}, DEFAULTS.ui, cfg.ui || {});
    cfg.ui.arc = Object.assign({}, DEFAULTS.ui.arc, cfg.ui.arc || {});
    cfg.growth = Object.assign({}, DEFAULTS.growth, cfg.growth || {});
    cfg.care = Object.assign({}, DEFAULTS.care, cfg.care || {});

    if (!Array.isArray(cfg.gapMs) || cfg.gapMs.length !== 2) {
      cfg.gapMs = DEFAULTS.gapMs.slice();
    }
    if (cfg.facing !== "left" && cfg.facing !== "right") {
      cfg.facing = DEFAULTS.facing;
    }
    if (cfg.corner !== "bottom-right" && cfg.corner !== "bottom-left") {
      cfg.corner = DEFAULTS.corner;
    }
    if (!cfg.dragAnim) {
      cfg.dragAnim = cfg.pools.drag || "";
    }

    const n = Number(cfg.size);
    cfg.size = Number.isFinite(n) ? clamp(n, 80, 600) : DEFAULTS.size;
    const pm = Number(cfg.state.pollMs);
    cfg.state.pollMs = Number.isFinite(pm)
      ? clamp(pm, 500, 30000)
      : DEFAULT_POLL_MS;

    return cfg;
  }
  return {
    ASSET_BASE,
    POS_KEY,
    SET_KEY,
    GROW_KEY,
    HINT_KEY,
    DRAG_THRESHOLD,
    DEFAULT_POLL_MS,
    IDLE,
    DEFAULTS,
    LABEL_GAP,
    normalizeConfig,
  };
}
