import { sessionActivity } from '../shared/activity.js';
import { sessionCost, PRICING } from '../shared/session-cost.js';

export function createUsageReader(getSessions, getConfig) {
    const cache = new WeakMap();
    return (sessionId) => {
        const session = getSessions()?.get(sessionId);
        if (!session || typeof session.snapshotEvents !== 'function') {
            return { ok: false, reason: 'session-unavailable', message: '会话尚未载入，请稍后重试。' };
        }
        const events = session.snapshotEvents();
        const config = getConfig() || PRICING;
        const old = cache.get(session);
        const minute = Math.floor(Date.now() / 60000);
        if (old && old.events === events && old.config === config && old.minute === minute) return old.value;
        const value = { ...sessionCost(events, Number(session.inheritedEventCount) || 0, config), sessionId, activity: sessionActivity(events, Number(session.inheritedEventCount) || 0) };
        cache.set(session, { events, config, minute, value });
        return value;
    };
}
