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

/**
 * @description Debounce optimistic edits and serialize writes; revisions and newer edits survive replies.
 * @param {object} options Save, notify, scheduling and validation callbacks.
 * @returns {object} Edit, sync, retry and flush controller.
 */
export function createAutosave({
  save,
  notify,
  valid = () => true,
  delay = 400,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let base = null,
    patch = {},
    inFlight = {},
    timer = null,
    running = false,
    error = "",
    closed = false;
  const view = () => ({
    data: base,
    draft: base ? { ...base.rules, ...inFlight, ...patch } : null,
    busy: running || timer !== null,
    error,
  });
  const emit = () => {
    if (!closed) notify(view());
  };
  const arm = () => {
    cancel(timer);
    timer = schedule(() => {
      timer = null;
      drain();
    }, delay);
  };
  const drain = async () => {
    if (running || !base || !Object.keys(patch).length) return;
    if (!valid({ ...base.rules, ...patch })) {
      error = "最少件数不能大于最多件数";
      emit();
      return;
    }
    const sent = patch;
    inFlight = sent;
    patch = {};
    running = true;
    error = "";
    emit();
    try {
      const result = await save({ ...base.rules, ...sent }, base.rulesRevision);
      if (!result.ok) {
        if (result.inventory?.rules) base = result.inventory;
        patch = { ...sent, ...patch };
        error =
          result.reason === "rules-conflict"
            ? "规则已在其他窗口修改，请检查后重试"
            : "规则无效，请检查范围";
      } else if (!base || result.revision >= base.revision) base = result;
    } catch {
      patch = { ...sent, ...patch };
      error = "保存失败，请重试";
    } finally {
      inFlight = {};
      running = false;
      emit();
      if (!error && Object.keys(patch).length) {
        if (closed) drain();
        else arm();
      }
    }
  };
  return {
    edit(key, value) {
      if (!base || Object.is(view().draft[key], value)) return;
      patch = { ...patch, [key]: value };
      error = "";
      arm();
      emit();
    },
    sync(value) {
      if (!value?.rules) return;
      if (!base || value.revision >= base.revision) base = value;
      emit();
    },
    retry() {
      error = "";
      cancel(timer);
      timer = null;
      drain();
    },
    flush() {
      closed = true;
      cancel(timer);
      timer = null;
      drain();
    },
    snapshot: view,
  };
}
