/**
 * @description Coalesce synchronous session events and run bookkeeping after the current event-loop turn.
 * @param {Function} observe Persist one session's settled usage.
 * @param {object} options Timing and failure handling.
 * @returns {object} Nonblocking scheduling and disposal operations.
 */
export function createSettlementObserver(
  observe,
  { schedule = setImmediate, cancel = clearImmediate, onError = () => {} } = {},
) {
  const pending = new Map(),
    running = new Set();
  const start = (item) => {
    const work = Promise.resolve()
      .then(() => observe(item))
      .catch(onError)
      .finally(() => running.delete(work));
    running.add(work);
    return work;
  };
  let scheduled = null,
    disposed = false;
  const enqueue = (session) => {
    if (disposed || !session) return;
    const id = session.header?.id || session.id;
    if (!id) return;
    pending.set(id, session);
    if (scheduled !== null) return;
    scheduled = schedule(() => {
      scheduled = null;
      if (disposed) return;
      const batch = [...pending.values()];
      pending.clear();
      for (const item of batch) start(item);
    });
  };
  return {
    enqueue,
    async dispose() {
      disposed = true;
      cancel(scheduled);
      scheduled = null;
      const batch = [...pending.values()];
      pending.clear();
      batch.forEach(start);
      await Promise.all([...running]);
    },
  };
}
