import { element, t } from "../i18n.js";
import { decoratePausedComposer } from "./scheduler-controls.js";

/**
 * @description Align the alpha composer dock and anchor its native context meter to the left of the model.
 * @param {Element} card Host composer card.
 * @returns {Function} Restore all owned layout attributes and styles.
 */
export function alignComposer(card) {
  const root = card.parentElement;
  if (!root) return () => {};
  const owned = new Map();
  let frame, stopped = false;
  const set = (node, key, value, style = false) => {
    if (!owned.has(node)) owned.set(node, new Map());
    const fields = owned.get(node), id = (style ? "style:" : "attr:") + key;
    if (!fields.has(id)) fields.set(id, { key, style, old: style ? node.style.getPropertyValue(key) : node.getAttribute(key) });
    if (style) { if (node.style.getPropertyValue(key) !== value) node.style.setProperty(key, value); }
    else if (node.getAttribute(key) !== value) node.setAttribute(key, value);
  };
  const restore = () => {
    for (const [node, fields] of owned) for (const field of fields.values()) {
      if (field.style) { if (field.old) node.style.setProperty(field.key, field.old); else node.style.removeProperty(field.key); }
      else if (field.old == null) node.removeAttribute(field.key);
      else node.setAttribute(field.key, field.old);
    }
    owned.clear();
  };
  const resize = new ResizeObserver(() => schedule());
  const update = () => {
    frame = null;
    if (stopped || !card.isConnected) return;
    const slot = root.querySelector('[data-slot="conversation.composer.dock"]');
    const dock = slot?.parentElement;
    if (!slot || dock === root || dock?.parentElement !== root) { restore(); return; }
    set(dock, "data-kj-composer-dock", "true");
    const stats = [...slot.children].find((child) => !child.classList.contains("kj-usage-root") && child.querySelector('button[aria-haspopup="dialog"]'));
    if (stats) set(stats, "data-kj-composer-stats", "true");
    const model = card.querySelector('[data-slot="conversation.input.model"]');
    const modelControl = model?.firstElementChild;
    const meter = [...dock.children].find((child) => child !== slot && child.querySelector('button[aria-haspopup="dialog"] svg[viewBox="0 0 14 14"] circle[cx="7"][r="5.5"]'));
    if (!modelControl || !meter) {
      restore();
      set(dock, "data-kj-composer-dock", "true");
      if (stats) set(stats, "data-kj-composer-stats", "true");
      return;
    }
    set(root, "data-kj-composer-root", "true");
    set(meter, "data-kj-context-meter", "true");
    const width = meter.getBoundingClientRect().width;
    set(modelControl, "--kj-context-space", `${width + 8}px`, true);
    set(modelControl, "data-kj-context-space", "true");
    const anchor = modelControl.getBoundingClientRect(), box = root.getBoundingClientRect(), height = meter.getBoundingClientRect().height;
    set(meter, "--kj-context-x", `${anchor.left - box.left - width - 8}px`, true);
    set(meter, "--kj-context-y", `${anchor.top - box.top + (anchor.height - height) / 2}px`, true);
    resize.observe(modelControl); resize.observe(meter);
  };
  const schedule = () => { if (!stopped && frame == null) frame = requestAnimationFrame(update); };
  const mutation = new MutationObserver(schedule);
  mutation.observe(root, { subtree: true, childList: true, characterData: true });
  resize.observe(root); resize.observe(card);
  window.addEventListener("resize", schedule);
  update();
  return () => { stopped = true; cancelAnimationFrame(frame); mutation.disconnect(); resize.disconnect(); window.removeEventListener("resize", schedule); restore(); };
}

/**
 * @description Render session-scoped pause controls using the shared server scheduler snapshot.
 * @param {object} React Host React.
 * @param {object} schedulerStore Shared confirmed scheduler state.
 * @param {Function} usePreferences Local presentation preferences.
 * @returns {Function} Session-scoped status component.
 */
export function createComposerPause(React, schedulerStore, usePreferences) {
  const h = (type, props, ...children) => element(React, type, props, ...children);
  return function ComposerPause({ sessionId }) {
    usePreferences();
    const view = schedulerStore.useScheduler();
    const ref = React.useRef(null), controller = React.useRef(null);
    const [hasStop, setHasStop] = React.useState(false);
    const state = view.data?.sessions?.find((item) => item.id === sessionId);
    const paused = state?.state === "paused", pausing = state?.state === "pausing";
    const disabled = view.busy || !!view.error || view.data?.rate !== "peak";
    const label = t("继续当前任务及子代理（本段峰价放行）");
    const statusLabel = t(view.data?.rate === "unknown" ? "调度暂停 · 请检查峰谷规则" : "峰价暂停 · 谷价自动继续");
    const goalLabel = t(view.data?.rate === "unknown" ? "调度暂停" : "峰价暂停");
    const pauseId = state?.pauseId;
    const resume = React.useCallback(() => schedulerStore.resume(sessionId, pauseId), [sessionId, pauseId]);
    React.useLayoutEffect(() => {
      const card = ref.current?.closest("[data-composer-card]");
      if (card) return alignComposer(card);
    }, [sessionId]);
    React.useLayoutEffect(() => {
      if (!paused) return;
      const card = ref.current?.closest("[data-composer-card]");
      if (!card) return;
      const adapter = decoratePausedComposer(card, { label, statusLabel: goalLabel, resume, disabled, goal: state.goal, onStopAvailable: setHasStop });
      controller.current = adapter;
      return () => { controller.current = null; adapter.dispose(); };
    }, [paused, sessionId, label, goalLabel, resume, disabled, state?.goal?.phase, state?.goal?.activation]);
    return h("span", { ref, className: "kj-composer-pause", "data-active": paused || pausing || undefined },
      h("span", { role: "status", "aria-live": "polite", title: t(view.error || (paused ? statusLabel : "等待当前步骤结束后暂停")) },
        paused || pausing ? view.error || (paused ? statusLabel : "等待当前步骤结束后暂停") : null),
      paused && hasStop ? h("button", {
        type: "button", className: "kj-scheduler-cancel", title: t("停止任务（取消自动续跑）"),
        "aria-label": t("停止任务（取消自动续跑）"), onClick: () => controller.current?.stop(),
      }, h("svg", { viewBox: "0 0 16 16", width: 14, height: 14, "aria-hidden": true },
        h("rect", { x: 4, y: 4, width: 8, height: 8, rx: 2, fill: "currentColor" }))) : null,
      paused ? h("button", {
        type: "button", className: "kj-scheduler-fallback-resume", title: label, "aria-label": label,
        disabled, onClick: resume,
      }, "继续") : null,
    );
  };
}
