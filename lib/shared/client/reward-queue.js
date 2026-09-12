/**
 * @description Compute new rewards from monotonic earned totals, independent of spending or mode.
 * @param {object|null} previous Previous successful inventory snapshot.
 * @param {object} next Next successful inventory snapshot.
 * @returns {Array} Positive per-kind gains.
 */
export function inventoryGains(previous, next) {
  if (!previous?.earned || !next?.earned) return [];
  return ["fish", "pat", "play", "stretch"].flatMap((kind) => {
    const count = next.earned[kind] - previous.earned[kind];
    const peakCount =
      (next.peakEarned?.[kind] || 0) - (previous.peakEarned?.[kind] || 0);
    return Number.isSafeInteger(count) && count > 0
      ? [{ kind, count, ...(peakCount > 0 ? { peak: true } : {}) }]
      : [];
  });
}
/**
 * @description Merge bursts into a bounded, sequential visual queue.
 * @param {Array} queue Pending gains.
 * @param {object} item New gain or session-start reaction.
 */
export function enqueueReward(queue, item) {
  const existing = queue.find((entry) => entry.kind === item.kind);
  if (existing) {
    existing.count += item.count;
    if (item.peak) existing.peak = true;
  } else queue.push({ ...item });
}
/**
 * @description Merge inventory responses without losing transient events or rerendering identical snapshots.
 * @param {object|null} previous Current inventory view.
 * @param {object} value Successful response.
 * @returns {object} New view or the unchanged current view.
 */
export function mergeInventoryView(previous, value) {
  if (previous?.revision > value.revision) return previous;
  const activity = value.activity || previous?.activity;
  const execution = value.execution || previous?.execution;
  if (
    previous?.ok &&
    previous.ok === value.ok &&
    !!previous.stale === !!value.stale &&
    previous.revision === value.revision &&
    previous.free === value.free &&
    previous.rewardMultiplier === value.rewardMultiplier &&
    previous.execution?.active === execution?.active &&
    previous.activity?.instance === activity?.instance &&
    previous.activity?.sequence === activity?.sequence
  )
    return previous;
  return {
    ...value,
    activity,
    execution,
    readyAt: Number.isFinite(value.cooldownMs)
      ? Date.now() + Math.max(0, Math.min(8000, value.cooldownMs))
      : previous?.readyAt || 0,
  };
}

// One in-page inventory source serves the mascot and the input-footer ring.
let inventorySnapshot = null;
const inventoryListeners = new Set();
/**
 * @description Publish settled inventory without starting a second network poller.
 * @param {object} value Latest inventory response.
 * @returns {object} Stable merged snapshot.
 */
export function publishInventory(value) {
  const next = mergeInventoryView(inventorySnapshot, value);
  if (next !== inventorySnapshot) {
    inventorySnapshot = next;
    inventoryListeners.forEach((listener) => listener(next));
  }
  return inventorySnapshot;
}
/**
 * @description Read the shared inventory snapshot.
 * @returns {object|null} Current value.
 */
export const getInventorySnapshot = () => inventorySnapshot;
/**
 * @description Observe inventory changes within this browser page.
 * @param {Function} listener Subscriber.
 * @returns {Function} Unsubscribe operation.
 */
export function subscribeInventory(listener) {
  inventoryListeners.add(listener);
  return () => inventoryListeners.delete(listener);
}
