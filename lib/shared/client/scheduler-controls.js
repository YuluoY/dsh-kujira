const STOP_ICON = 'svg[viewBox="0 0 16 16"] > rect[x="3"][y="3"][width="10"][height="10"][rx="3"]';

/**
 * @description Adapt verified stop and Goal controls to the confirmed pause of their own composer.
 * @param {Element} card Session composer.
 * @param {object} options Labels, confirmed Goal state and guarded resume action.
 * @returns {object} Original cancellation action and complete adapter cleanup.
 */
export function decoratePausedComposer(card, { label, statusLabel, resume, disabled, goal, onStopAvailable }) {
  const root = card.closest("[data-composer-seat]") || card.parentElement || card;
  const owned = new Map();
  let primary, forwardingStop = false, stopAvailable;
  const set = (node, key, value) => {
    if (!owned.has(node)) owned.set(node, new Map());
    const fields = owned.get(node);
    if (!fields.has(key)) fields.set(key, { old: node.getAttribute(key), value });
    else if (node.getAttribute(key) !== fields.get(key).value) fields.get(key).old = node.getAttribute(key);
    fields.get(key).value = value;
    if (node.getAttribute(key) !== value) node.setAttribute(key, value);
  };
  const restore = (node) => {
    for (const [key, field] of owned.get(node) || []) {
      if (node.getAttribute(key) !== field.value) continue;
      if (field.old === null) node.removeAttribute(key);
      else node.setAttribute(key, field.old);
    }
    owned.delete(node);
  };
  const markResume = (button) => {
    set(button, "data-kj-peak-paused", "true");
    set(button, "aria-label", label);
    set(button, "title", label);
    set(button, "aria-disabled", String(disabled));
  };
  const update = () => {
    const wanted = new Set();
    const stops = [...card.querySelectorAll("button")].filter((button) => !button.disabled && button.querySelector(STOP_ICON));
    primary = stops.at(-1);
    if (stopAvailable !== !!primary) { stopAvailable = !!primary; onStopAvailable?.(stopAvailable); }
    if (primary && owned.get(primary)?.has("data-kj-duplicate-stop")) restore(primary);
    if (primary) { wanted.add(primary); markResume(primary); }
    for (const button of stops.slice(0, -1)) {
      if (owned.get(button)?.has("data-kj-peak-paused")) restore(button);
      wanted.add(button);
      set(button, "data-kj-duplicate-stop", "true");
    }
    if (goal?.phase === "active" && goal.activation === "armed") {
      const bar = root.querySelector("[data-goal-bar]");
      const glyph = bar?.querySelector("[class$='_goalGlyph']");
      const phase = bar?.querySelector("[class$='_label']");
      const control = [...(bar?.querySelectorAll("button") || [])].find((button) =>
        /^(暂停目标|Pause goal)$/.test(button.getAttribute("aria-label")) ||
        (button.getAttribute("aria-label") === label && owned.get(button)?.has("data-kj-peak-paused")),
      );
      if (glyph && phase && control) {
        wanted.add(glyph); wanted.add(phase); wanted.add(control);
        set(glyph, "data-kj-goal-paused", "true");
        set(glyph, "role", "img");
        set(glyph, "aria-label", statusLabel);
        set(phase, "data-kj-goal-label", statusLabel);
        set(phase, "aria-hidden", "true");
        markResume(control);
      }
    }
    for (const node of [...owned.keys()]) if (!wanted.has(node)) restore(node);
  };
  const intercept = (event) => {
    if (forwardingStop) return;
    const button = event.target.closest?.("button[data-kj-peak-paused]");
    if (!button || !owned.has(button)) return;
    if (button === primary && !button.querySelector(STOP_ICON)) return;
    event.stopImmediatePropagation();
    if (event.type !== "click") return;
    event.preventDefault();
    if (!disabled) resume();
  };
  const events = ["click", "pointerover", "focusin"];
  for (const name of events) root.addEventListener(name, intercept, true);
  const observer = new MutationObserver(update);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label", "disabled"] });
  update();
  return {
    stop() {
      if (!primary?.isConnected || !primary.querySelector(STOP_ICON)) return;
      forwardingStop = true;
      try { primary.click(); } finally { forwardingStop = false; }
    },
    dispose() {
      observer.disconnect();
      for (const name of events) root.removeEventListener(name, intercept, true);
      for (const node of [...owned.keys()]) restore(node);
    },
  };
}
