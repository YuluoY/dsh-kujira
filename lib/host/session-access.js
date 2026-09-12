/**
 * @description Read live or persisted sessions without activating an Agent.
 * @param {Function} getSessions Live session service accessor.
 * @param {Function} getController Read-only history service accessor.
 * @param {object} options Cache clock, lifetime and entry limit.
 * @returns {object} Shared session lookup, preparation and cleanup operations.
 */
export function createSessionAccess(getSessions, getController, {now = Date.now, ttl = 5000, limit = 12} = {}) {
    const cache = new Map();
    const pending = new Map();
    let generation = 0;
    const get = id => getSessions()?.get(id) || cache.get(id)?.session;
    const prepare = async id => {
        const live = getSessions()?.get(id);
        if (live) { cache.delete(id); return live; }
        const old = cache.get(id);
        if (old && now() - old.at < ttl) return old.session;
        const controller = getController();
        if (!controller?.inspect) { cache.delete(id); return undefined; }
        if (pending.has(id)) return pending.get(id);
        const epoch = generation;
        const read = Promise.resolve().then(() => controller.inspect(id, AbortSignal.timeout(8000))).then(value => {
            if (epoch !== generation || controller !== getController()) return undefined;
            if (!value?.meta || !Array.isArray(value.events)) throw new Error('Invalid session inspection');
            const session = {id, header:value.meta, inheritedEventCount:value.inheritedEventCount || 0, snapshotEvents:() => value.events};
            cache.delete(id);
            cache.set(id, {at:now(), session});
            while (cache.size > limit) cache.delete(cache.keys().next().value);
            return getSessions()?.get(id) || session;
        }).catch(() => { if (epoch === generation) cache.delete(id); return undefined; }).finally(() => {
            if (pending.get(id) === read) pending.delete(id);
        });
        pending.set(id, read);
        return read;
    };
    return {get, getLive:id=>getSessions()?.get(id), prepare, clear:() => {generation++; cache.clear(); pending.clear();}};
}
