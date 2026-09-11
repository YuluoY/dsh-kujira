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
  if (
    previous?.ok &&
    !previous.stale &&
    previous.revision === value.revision &&
    previous.free === value.free &&
    previous.rewardMultiplier === value.rewardMultiplier &&
    previous.activity?.instance === activity?.instance &&
    previous.activity?.sequence === activity?.sequence
  )
    return previous;
  return { ...value, activity };
}
