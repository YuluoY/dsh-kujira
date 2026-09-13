/**
 * @description Await work until a consumer cancels and release its abort listener.
 * @template T
 * @param {Promise<T>} task Shared asynchronous work.
 * @param {AbortSignal} [signal] Consumer lifetime.
 * @returns {Promise<T>} Result or cancellation.
 */
export function untilAbort(task, signal) {
  if (!signal) return task;
  if (signal.aborted) {
    task.catch(() => {});
    return Promise.reject(signal?.reason);
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason || Error("aborted"));
    };
    signal.addEventListener("abort", abort, { once: true });
    task
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/**
 * @description Bound concurrent history reads and remove cancelled queued jobs.
 * @param {number} limit Maximum running reads.
 * @returns {(work:() => unknown, signal?:AbortSignal) => Promise<unknown>} Scheduler accepting work and a deadline signal.
 */
export function createReadPool(limit = 4) {
  let running = 0;
  /**
   * @type {Set<{work:() => unknown, signal?:AbortSignal, resolve:(value:unknown) => void, reject:(reason?:unknown) => void, abort:() => void}>}
   */
  const queued = new Set();
  const drain = () => {
    while (running < limit && queued.size) {
      const job = queued.values().next().value;
      if (!job) break;
      queued.delete(job);
      job.signal?.removeEventListener("abort", job.abort);
      if (job.signal?.aborted) {
        job.reject(job.signal.reason);
        continue;
      }
      running++;
      Promise.resolve()
        .then(job.work)
        .then(job.resolve, job.reject)
        .finally(() => {
          running--;
          drain();
        });
    }
  };
  return (work, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal?.reason);
        return;
      }
      if (queued.size >= 256) {
        reject(Error("history-read-busy"));
        return;
      }
      const job = {
        work,
        signal,
        resolve,
        reject,
        abort: () => {
          queued.delete(job);
          reject(signal?.reason);
        },
      };
      queued.add(job);
      signal?.addEventListener("abort", job.abort, { once: true });
      drain();
    });
}

/**
 * @description Subscribe to work without allowing one consumer to cancel another.
 * @template T
 * @param {{promise:Promise<T>,controller:AbortController,consumers:number,done:boolean}} job Shared work.
 * @param {AbortSignal} [signal] Consumer lifetime.
 * @returns {Promise<T>} Consumer-scoped result.
 */
export function subscribeWork(job, signal) {
  job.consumers++;
  return untilAbort(job.promise, signal).finally(() => {
    job.consumers--;
    if (!job.consumers && !job.done)
      job.controller.abort(Error("no-consumers"));
  });
}
