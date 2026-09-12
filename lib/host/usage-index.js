import { usageRecords, PRICING } from "../shared/session-cost.js";
/**
 * @description Reuse immutable DSH log prefixes and fold only newly appended events.
 * @returns {Function} Session-local usage index reader.
 */
export function createUsageIndex() {
  const cache = new WeakMap();
  return (session, config = PRICING) => {
    const events = session.snapshotEvents(),
      inherited = Number(session.inheritedEventCount) || 0;
    const old = cache.get(session);
    const compatible =
      old &&
      old.config === config &&
      old.inherited === inherited &&
      events.length >= old.length &&
      events[0] === old.first &&
      (!old.length || events[old.length - 1] === old.last);
    if (compatible && events.length === old.length) return old.value;
    const seed = compatible ? old.value : null;
    const value = {
      ...usageRecords(events, inherited, config, seed),
      version: (old?.value.version || 0) + 1,
      baseVersion: seed?.version || 0,
      scanned: events.length - (seed?.offset || 0),
    };
    cache.set(session, {
      config,
      inherited,
      length: events.length,
      first: events[0],
      last: events.at(-1),
      value,
    });
    return value;
  };
}
