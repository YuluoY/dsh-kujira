import {createUsageIndex} from './usage-index.js';
import {rateAt,nextSwitch} from '../shared/billing.js';
import { costFromRecords, PRICING } from '../shared/session-cost.js';

export function createUsageReader(getSessions, getConfig) {
    const cache = new WeakMap(), index=createUsageIndex();
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
        const now=Date.now();
        const value = old && old.events===events && old.config===config
          ? {...old.value,rate:rateAt(now,config),next:nextSwitch(now,config),updatedAt:now}
          : {...costFromRecords(index(session,config),config,now,Number(session.inheritedEventCount)||0),sessionId};
        cache.set(session, { events, config, minute, value });
        return value;
    };
}
