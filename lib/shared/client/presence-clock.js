import { isActiveStage } from "../task/status.js";
/**
 * @description Expire a visible bubble independently of polling, focus and rerenders.
 * @param {Function} update Visibility subscriber.
 * @param {object} options Injectable clock and timers.
 * @returns {object} Show, synchronize and dispose operations.
 */
export function createPresenceClock(
  update,
  { now = Date.now, schedule = setTimeout, cancel = clearTimeout } = {},
) {
  let timer,
    deadline = 0,
    disposed = false;
  const sync = () => {
    cancel(timer);
    if (disposed) return;
    const remaining = deadline - now();
    update(remaining > 0);
    if (remaining > 0) timer = schedule(sync, remaining);
  };
  return {
    show: (duration) => {
      deadline = now() + duration;
      sync();
    },
    sync,
    hide: () => {
      deadline = 0;
      sync();
    },
    dispose: () => {
      disposed = true;
      cancel(timer);
    },
  };
}

/**
 * @description Classify verified balance values in their original currency for decorative reactions.
 * @param {object} balance Current API view.
 * @returns {string|null} Stable band, with no currency conversion or inference for unknown currencies.
 */
export function balanceMood(balance) {
  if (!balance?.ok || balance.loading || balance.stale || balance.refreshError)
    return null;
  if (balance.total == null || balance.total === "") return null;
  const total = Number(balance.total),
    currency = balance.rawCurrency;
  if (!Number.isFinite(total) || total < 0) return null;
  if (total === 0) return "empty";
  const levels = { CNY: [10, 100], USD: [2, 20] }[currency];
  if (!levels) return "normal";
  return total < levels[0] ? "low" : total >= levels[1] ? "plenty" : "normal";
}
/**
 * @description Produce bounded, deduplicated reactions from public facts without timers or model calls.
 * @param {object} options Clock and randomness for deterministic checks.
 * @returns {Function} State observer returning at most one reaction per observation.
 */
export function createContextReactions({
  now = Date.now,
  random = Math.random,
} = {}) {
  let task = null,
    lastReaction = -Infinity,
    lastBalance = null,
    lastIdle = now();
  return ({
    activity: a,
    sessionId,
    balance,
    panel,
    enabled = true,
    quiet = false,
    hidden = false,
    hideBalance = false,
  }) => {
    const time = now(),
      active =
        a?.startedAt != null &&
        Number.isFinite(a.startedAt) &&
        isActiveStage(a.stage) &&
        a.endedAt == null;
    const key = sessionId + ":" + a?.startedAt;
    if (task?.key !== key)
      task = {
        key,
        last: time,
        active,
        observable: !hidden && !quiet && enabled,
        seen: active,
        activeMs: 0,
        done: !!a?.endedAt,
        long: false,
      };
    const delta = time - task.last;
    if (
      active &&
      task.active &&
      delta >= 0 &&
      delta <= 60000 &&
      task.observable &&
      !hidden &&
      !quiet &&
      enabled
    )
      task.activeMs += delta;
    const wasActive = task.seen;
    task.last = time;
    task.active = active;
    task.observable = !hidden && !quiet && enabled;
    task.seen ||= active;
    let event = null;
    if (a?.endedAt && !task.done) {
      task.done = true;
      const duration = a.endedAt - a.startedAt;
      if (
        wasActive &&
        a.stage === "done" &&
        time - a.endedAt >= 0 &&
        time - a.endedAt < 30000 &&
        duration >= 0
      )
        event =
          duration <= 30000
            ? {
                animation: "点击回应 - 开心跃动",
                text: "这么快就完成啦。",
                kind: "done",
                key,
              }
            : duration >= 600000
              ? {
                  animation: "超大伸懒腰",
                  text: "这一段忙完了，歇一小会儿。",
                  kind: "done",
                  key,
                }
              : null;
    }
    if (active && task.activeMs >= 600000 && !task.long) {
      task.long = true;
      event = {
        animation: "喝奶茶",
        text: "我陪着你，慢慢把这一段做好。",
        kind: "work",
        key,
      };
    }
    const band = balanceMood(balance),
      balanceKey = band && balance.rawCurrency + ":" + band;
    if (panel === "balance" && band && balanceKey !== lastBalance) {
      lastBalance = balanceKey;
      if (!active && !hideBalance && !event)
        event = {
          kind: "balance",
          scene: {
            plenty: "balancePlenty",
            normal: "balanceNormal",
            low: "balanceLow",
            empty: "balanceEmpty",
          }[band],
          animation:
            band === "plenty"
              ? "点击回应 - 开心跃动"
              : band === "low" || band === "empty"
                ? "翻钱包"
                : "女仆屈膝礼仪",
          text:
            band === "plenty"
              ? "小钱包收好啦。"
              : band === "low" || band === "empty"
                ? "我来把零钱收好。"
                : null,
        };
    }
    if (active) lastIdle = time;
    if (!active && !a?.endedAt && time - lastIdle >= 600000) {
      lastIdle = time;
      if (random() < 0.35)
        event = {
          kind: "idle",
          animation: "鲸鱼吐泡泡特效",
          text: "我在这里，等你准备好。",
        };
    }
    if (
      !enabled ||
      quiet ||
      hidden ||
      ["waiting", "error", "paused"].includes(a?.stage)
    )
      return null;
    if (!event || time - lastReaction < 120000) return null;
    lastReaction = time;
    return event;
  };
}
