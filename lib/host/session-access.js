import { createReadPool, subscribeWork, untilAbort } from "./async-work.js";

/**
 * @description Share cancellable history reads without activating an Agent.
 * @param {Function} getSessions Live session service.
 * @param {Function} getController Read-only history service.
 * @param {object} options Cache and concurrency bounds.
 * @returns {object} Lookup, preparation, invalidation and disposal.
 */
export function createSessionAccess(
  getSessions,
  getController,
  {
    now = Date.now,
    ttl = 5000,
    limit = 12,
    concurrency = 4,
    timeoutMs = 8000,
  } = {},
) {
  const cache = new Map(),
    pending = new Map(),
    pool = createReadPool(concurrency);
  let generation = 0;
  const get = (id) => getSessions()?.get(id) || cache.get(id)?.session;
  const prepare = (id, { signal } = {}) => {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const live = getSessions()?.get(id);
    if (live) {
      cache.delete(id);
      return Promise.resolve(live);
    }
    const old = cache.get(id);
    if (old && now() - old.at < ttl) {
      cache.delete(id);
      cache.set(id, old);
      return Promise.resolve(old.session);
    }
    const controller = getController();
    if (!controller?.inspect) {
      cache.delete(id);
      return Promise.resolve(undefined);
    }
    let job = pending.get(id);
    if (!job || job.controller.signal.aborted) {
      job = { controller: new AbortController(), consumers: 0, done: false };
      const epoch = generation,
        current = job;
      const deadline = setTimeout(
        () => current.controller.abort(Error("history-timeout")),
        timeoutMs,
      );
      deadline.unref?.();
      current.promise = untilAbort(
        pool(
          () => controller.inspect(id, current.controller.signal),
          current.controller.signal,
        ),
        current.controller.signal,
      )
        .then((value) => {
          if (
            epoch !== generation ||
            current.controller.signal.aborted ||
            controller !== getController()
          )
            return undefined;
          if (!value?.meta || !Array.isArray(value.events))
            throw Error("invalid-session-inspection");
          const session = {
            id,
            header: value.meta,
            inheritedEventCount: value.inheritedEventCount || 0,
            snapshotEvents: () => value.events,
          };
          cache.delete(id);
          cache.set(id, { at: now(), session });
          while (cache.size > limit) cache.delete(cache.keys().next().value);
          return getSessions()?.get(id) || session;
        })
        .catch(() => {
          if (epoch === generation && pending.get(id) === current)
            cache.delete(id);
          return undefined;
        })
        .finally(() => {
          current.done = true;
          clearTimeout(deadline);
          if (pending.get(id) === current) pending.delete(id);
        });
      pending.set(id, current);
    }
    return subscribeWork(job, signal);
  };
  return {
    get,
    getLive: (id) => getSessions()?.get(id),
    prepare,
    invalidate: (id) => cache.delete(id),
    clear() {
      generation++;
      cache.clear();
      for (const job of pending.values())
        job.controller.abort(Error("history-disposed"));
      pending.clear();
    },
  };
}
