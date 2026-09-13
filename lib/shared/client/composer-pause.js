import { element, t } from "../i18n.js";

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
