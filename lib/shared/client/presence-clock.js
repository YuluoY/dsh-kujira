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
    dispose: () => {
      disposed = true;
      cancel(timer);
    },
  };
}
