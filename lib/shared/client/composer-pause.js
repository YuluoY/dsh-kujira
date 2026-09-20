import { element, t } from "../i18n.js";

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
 * @description Decorate only the verified host stop control, preserving its cancellation handler.
 * @param {Element} card Current session composer card.
 * @param {string} label Accessible pause-state and stop-action description.
 * @returns {Function} Complete restoration of owned attributes.
 */
export function decoratePausedComposer(card, label) {
  const owned = new Map();
  const restore = (button) => {
    const old = owned.get(button);
    if (!old) return;
    button.removeAttribute("data-kj-peak-paused");
    if (button.getAttribute("aria-label") === label) {
      if (old.label == null) button.removeAttribute("aria-label");
      else button.setAttribute("aria-label", old.label);
    }
    owned.delete(button);
  };
  const update = () => {
    const buttons = [...card.querySelectorAll("button")].filter((button) =>
      button.querySelector(
        'svg[viewBox="0 0 16 16"] > rect[x="3"][y="3"][width="10"][height="10"][rx="3"]',
      ),
    );
    for (const button of [...owned.keys()])
      if (!buttons.includes(button)) restore(button);
    for (const button of buttons) {
      if (!owned.has(button))
        owned.set(button, { label: button.getAttribute("aria-label") });
      else if (button.getAttribute("aria-label") !== label)
        owned.get(button).label = button.getAttribute("aria-label");
      if (!button.hasAttribute("data-kj-peak-paused"))
        button.setAttribute("data-kj-peak-paused", "true");
      if (button.getAttribute("aria-label") !== label)
        button.setAttribute("aria-label", label);
    }
  };
  const observer = new MutationObserver(update);
  observer.observe(card, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-label"],
  });
  update();
  return () => {
    observer.disconnect();
    for (const button of [...owned.keys()]) restore(button);
  };
}

/**
 * @description Create a composer-slot pause indicator backed by the existing activity subscription.
 * @param {object} React Host React.
 * @param {object} runtime Shared task activity.
 * @param {Function} usePreferences Local presentation preferences.
 * @returns {Function} Session-scoped status component.
 */
export function createComposerPause(React, runtime, usePreferences) {
  const h = (type, props, ...children) =>
    element(React, type, props, ...children);
  return function ComposerPause({ sessionId }) {
    usePreferences();
    const view = runtime.useActivity(),
      ref = React.useRef(null);
    const state =
      view.sessionId === sessionId && !view.error
        ? view.data?.scheduling
        : null;
    const paused = !!state?.paused,
      pausing = !!state?.pausing;
    const label = t("调度暂停；点击停止任务将取消自动续跑");
    React.useLayoutEffect(() => {
      const card = ref.current?.closest("[data-composer-card]");
      if (card) return alignComposer(card);
    }, [sessionId]);
    React.useEffect(() => {
      if (!paused) return;
      const card = ref.current?.closest("[data-composer-card]");
      if (card) return decoratePausedComposer(card, label);
    }, [paused, sessionId, label]);
    return h(
      "span",
      {
        ref,
        className: "kj-composer-pause",
        "data-active": paused || pausing || undefined,
        role: "status",
        "aria-live": "polite",
      },
      paused || pausing
        ? h(
            "span",
            null,
            paused
              ? state.rate === "unknown"
                ? "调度暂停 · 请检查峰谷规则"
                : "峰价暂停 · 谷价自动继续"
              : "等待当前步骤结束后暂停",
          )
        : null,
    );
  };
}
