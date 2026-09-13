import { subscribeWork, untilAbort } from "./async-work.js";
import { createUsageIndex } from "./usage-index.js";
import { costFromRecords, PRICING } from "../shared/session-cost.js";

/**
 * @description Price each session once and aggregate verified descendant ownership on demand.
 * @param {Function} getSessions Live and read-only session access.
 * @param {Function} getConfig Verified historical pricing accessor.
 * @returns {Function} Local reader with async tree aggregation for the footer.
 */
export function createUsageReader(
  getSessions,
  getConfig,
  { timeoutMs = 7000 } = {},
) {
  const cache = new WeakMap(),
    index = createUsageIndex({ mutable: true }),
    pending = new Map(),
    settled = new Map();
  let revision = 0;
  const fold = (session, sessionId, config, now) => {
    const records = index(session, config),
      old = cache.get(session);
    const minute = Math.floor(now / 60000);
    if (
      old?.records === records &&
      old.minute === minute &&
      old.config === config
    )
      return old.value;
    const value = {
      ...costFromRecords(
        records,
        config,
        now,
        Number(session.inheritedEventCount) || 0,
      ),
      sessionId,
    };
    cache.set(session, { records, minute, config, value });
    return value;
  };
  const unavailable = (sessionId) => ({
    ok: false,
    sessionId,
    reason: "session-unavailable",
    message: "会话尚未载入，请稍后重试。",
  });
  const read = (sessionId) => {
    const session = getSessions()?.get(sessionId);
    return typeof session?.snapshotEvents === "function"
      ? fold(session, sessionId, getConfig() || PRICING, Date.now())
      : unavailable(sessionId);
  };
  read.invalidate = (id) => {
    revision++;
    settled.delete(id);
  };
  read.tree = (sessionId, { signal } = {}) => {
    let shared = pending.get(sessionId);
    if (shared && !shared.controller.signal.aborted)
      return signal
        ? subscribeWork(shared, signal)
        : (shared.publicPromise ||= subscribeWork(shared));
    shared = { controller: new AbortController(), consumers: 0, done: false };
    const deadline = setTimeout(
      () => shared.controller.abort(Error("usage-deadline")),
      timeoutMs,
    );
    deadline.unref?.();
    const requestSignal = shared.controller.signal;
    const task = (async () => {
      const access = getSessions(),
        config = getConfig() || PRICING,
        now = Date.now(),
        startRevision = revision;
      const root =
        access?.get(sessionId) ||
        (await untilAbort(
          Promise.resolve(
            access?.prepare?.(sessionId, { signal: requestSignal }),
          ),
          requestSignal,
        ));
      if (typeof root?.snapshotEvents !== "function")
        return unavailable(sessionId);
      const own = fold(root, sessionId, config, now);
      const result = {
        ...own,
        totals: { ...own.totals },
        byRate: { ...own.byRate },
        skipped: [...own.skipped],
        selfTotal: own.totals.total,
        children: {
          count: 0,
          total: 0,
          requests: 0,
          pricedRequests: 0,
          complete: true,
          unavailable: 0,
        },
      };
      const queue = [...(index(root, config).children || [])].map((id) => ({
        id,
        parent: sessionId,
        depth: 1,
      }));
      const seen = new Set([sessionId]);
      while (queue.length && seen.size <= 256 && !requestSignal.aborted) {
        const batch = [];
        while (queue.length && batch.length < 4 && seen.size <= 256) {
          const entry = queue.shift();
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
          batch.push(entry);
        }
        const values = await Promise.all(
          batch.map(async (entry) => {
            try {
              const live = access?.getLive?.(entry.id);
              if (live) return live;
              const saved = settled.get(entry.id);
              if (saved && saved.config === config && now - saved.at < 60000)
                return saved;
              return (
                (await untilAbort(
                  Promise.resolve(
                    access?.prepare?.(entry.id, { signal: requestSignal }),
                  ),
                  requestSignal,
                )) || access?.get(entry.id)
              );
            } catch {
              return null;
            }
          }),
        );
        for (let i = 0; i < batch.length; i++) {
          const entry = batch[i],
            session = values[i];
          if (
            (!session?.priced &&
              typeof session?.snapshotEvents !== "function") ||
            session.header?.origin !== "subagent" ||
            session.header.parentSession !== entry.parent
          ) {
            result.children.unavailable++;
            continue;
          }
          const child = session.priced || fold(session, entry.id, config, now);
          result.children.count++;
          result.children.total += child.totals.total;
          result.children.requests += child.requests;
          result.children.pricedRequests +=
            child.requests - child.skipped.length;
          result.children.complete &&= child.complete;
          result.requests += child.requests;
          result.hasUsage ||= child.hasUsage;
          result.complete &&= child.complete;
          for (const key of Object.keys(result.totals))
            result.totals[key] += child.totals[key];
          for (const key of Object.keys(result.byRate))
            result.byRate[key] += child.byRate[key];
          result.skipped.push(...child.skipped);
          const descendants = session.descendants || [
            ...(index(session, config).children || []),
          ];
          if (
            revision === startRevision &&
            !session.priced &&
            session.snapshotEvents().at(-1)?.type === "turn/end"
          ) {
            settled.delete(entry.id);
            settled.set(entry.id, {
              header: session.header,
              priced: child,
              descendants,
              config,
              at: now,
            });
            while (settled.size > 256)
              settled.delete(settled.keys().next().value);
          }
          if (entry.depth >= 24)
            result.children.unavailable += descendants.length;
          else
            queue.push(
              ...descendants.map((id) => ({
                id,
                parent: entry.id,
                depth: entry.depth + 1,
              })),
            );
        }
      }
      result.children.unavailable += queue.filter(
        (entry) => !seen.has(entry.id),
      ).length;
      if (result.children.unavailable) {
        result.complete = false;
        result.children.complete = false;
      }
      return result;
    })().finally(() => {
      shared.done = true;
      clearTimeout(deadline);
      if (pending.get(sessionId) === shared) pending.delete(sessionId);
    });
    shared.promise = task;
    if (!signal) shared.publicPromise = subscribeWork(shared);
    pending.set(sessionId, shared);
    return signal ? subscribeWork(shared, signal) : shared.publicPromise;
  };
  return read;
}
