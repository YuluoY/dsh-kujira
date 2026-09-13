/**
 * @description Coalesce per-session notifications and bound in-flight bookkeeping.
 * @param {Function} observe Persist one session's settled usage.
 * @param {object} options Scheduling, concurrency and error handling.
 * @returns {object} Enqueue and graceful drain operations.
 */
export function createSettlementObserver(
  observe,
  {
    schedule = setImmediate,
    cancel = clearImmediate,
    onError = () => {},
    concurrency = 4,
  } = {},
) {
  const pending = new Map(),
    running = new Map();
  let scheduled = null,
    disposed = false;
  const arm = () => {
    if (disposed || scheduled !== null || !pending.size) return;
    scheduled = schedule(() => {
      scheduled = null;
      drain();
    });
  };
  const drain = () => {
    for (const [id, session] of pending) {
      if (running.size >= concurrency) break;
      if (running.has(id)) continue;
      pending.delete(id);
      const task = Promise.resolve()
        .then(() => observe(session))
        .catch(onError)
        .finally(() => {
          running.delete(id);
          arm();
        });
      running.set(id, task);
    }
  };
  return {
    enqueue(session) {
      const id = session?.header?.id || session?.id;
      if (disposed || !id) return;
      pending.set(id, session);
      arm();
    },
    async dispose() {
      disposed = true;
      cancel(scheduled);
      scheduled = null;
      while (pending.size || running.size) {
        drain();
        await Promise.all([...running.values()]);
      }
    },
  };
}
