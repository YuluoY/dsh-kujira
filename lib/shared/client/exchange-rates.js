import { publishExchange, subscribeExchange, exchangeSnapshot } from "../exchange.js";
const INTERVAL = 15 * 60000;
let users = 0, timer, controller, pending, retryAt = 0;
/**
 * @description Share one non-blocking rate subscription across all mounted plugin surfaces.
 * @param {Function} listener React state subscriber.
 * @returns {Function} Release listeners, timer and in-flight request when the last surface unmounts.
 */
export function observeExchange(listener) {
  const unsubscribe = subscribeExchange(listener);
  users++;
  if (users === 1) {
    document.addEventListener("visibilitychange", refreshVisible);
    refreshVisible();
  }
  listener(exchangeSnapshot());
  return () => {
    unsubscribe();
    if (--users === 0) {
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", refreshVisible);
    }
  };
}
function refreshVisible() {
  clearTimeout(timer);
  if (!users || document.hidden) return;
  if (Date.now() < retryAt) {
    timer = setTimeout(refreshVisible, retryAt - Date.now());
    return;
  }
  if (pending) return;
  controller = new AbortController();
  const signal = controller.signal;
  const timeout = setTimeout(() => controller.abort(), 7000);
  pending = fetch("/dsh-kujira/exchange", { signal, cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw Error("exchange");
      const value = await response.json();
      if (!signal.aborted) {
        publishExchange(value);
        retryAt = Date.now() + (value.ok && !value.stale ? INTERVAL : 60000);
      }
    })
    .catch(() => {
      if (users) {
        const previous = exchangeSnapshot();
        publishExchange(previous?.ok ? { ...previous, stale: true } : { ok: false });
        retryAt = Date.now() + 60000;
      }
    })
    .finally(() => {
      clearTimeout(timeout);
      pending = null;
      if (users && !document.hidden) timer = setTimeout(refreshVisible, Math.max(1000, retryAt - Date.now()));
    });
}
