import { randomUUID } from "node:crypto";
/**
 * @description Track first starts of new main and child sessions without resuming agents.
 * @param {Function} now Clock for transient events.
 * @returns {object} First-start observer and bounded event snapshot.
 */
export function createCompanionEvents(now = Date.now) {
  const instance = randomUUID(),
    seen = new Set(),
    events = [];
  let sequence = 0;
  return {
    started({ agent, status }) {
      if (status !== "running" || !agent?.session) return;
      const session = agent.session,
        id = session.id || session.header?.id;
      if (!id || seen.has(id)) return;
      seen.add(id);
      if (seen.size > 2048) seen.delete(seen.values().next().value);
      const own =
        session
          .snapshotEvents?.()
          .slice(Number(session.inheritedEventCount) || 0) || [];
      if (own.some((event) => event.type === "turn/start")) return;
      events.push({ sequence: ++sequence, time: now(), kind: "start" });
      if (events.length > 64) events.shift();
    },
    snapshot: () => ({ instance, sequence, events: events.slice() }),
  };
}
