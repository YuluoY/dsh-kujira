/** Session-local accounting. Only durable provider usage is billed; no text is retained. */
import { costOf, rateAt, nextSwitch } from './billing.js';

// Official CNY page checked 2026-09-11. Earlier history is deliberately unpriced.
export const PRICING = {
    source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
    verifiedAt: '2026-09-11', currency: 'CNY',
    peakHours: [[9, 12], [14, 18]], workdays: [1, 2, 3, 4, 5], peakMultiplier: 2,
    prices: {
        'deepseek-flash': { history: [{ from: '2026-09-11T00:00:00+08:00', hit: .02, miss: 1, out: 4 }] },
        'deepseek-v4-flash': { history: [{ from: '2026-09-11T00:00:00+08:00', hit: .02, miss: 1, out: 4 }] },
        'deepseek-v4-pro': { history: [{ from: '2026-09-11T00:00:00+08:00', hit: .15, miss: 4.5, out: 13.5 }] }
    }
};
const count = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
export function normalizeUsage(raw) {
    if (!raw) return null;
    const miss = count(raw.inputTokens), out = count(raw.outputTokens);
    const hit = raw.cacheReadTokens == null ? 0 : count(raw.cacheReadTokens);
    const write = raw.cacheWriteTokens == null ? 0 : count(raw.cacheWriteTokens);
    if ([miss, out, hit, write].includes(null)) return null;
    return { hitTokens: hit, missTokens: miss + write, outTokens: out };
}

/** Fold the full immutable log, excluding inherited branch usage but retaining its route. */
export function sessionCost(events, inherited = 0, config = PRICING, now = Date.now()) {
    const rows = new Map();
    let route = {}, attempt = 0, reported = 0;
    for (let index = 0; index < events.length; index++) {
        const event = events[index], d = event.data || {};
        if (event.type === 'request/header') route = d.header?.config || {};
        if (event.type === 'request/context') route = { ...route, ...d };
        if (index < inherited) continue;
        if (event.type === 'llm/retry-started') attempt++;
        if (!['assistant/message', 'assistant/attempt'].includes(event.type)) continue;
        let sample = d.usage;
        let usageTime = event.time;
        if (Array.isArray(d.stream)) {
            for (let i = d.stream.length - 1; i >= 0; i--) {
                const chunk = d.stream[i].chunk;
                if (chunk?.type === 'usage') { sample = sample || chunk.usage; usageTime = d.stream[i].time ?? event.time; break; }
            }
        }
        if (!sample) continue;
        reported++;
        const usage = normalizeUsage(sample);
        const model = route.model || null;
        const provider = route.provider || null;
        const ts = typeof usageTime === 'number' ? usageTime : NaN;
        const key = Number.isInteger(d.turn) && Number.isInteger(d.step) ? `${d.turn}:${d.step}:${attempt}` : `seq:${event.seq ?? index}`;
        // Matching turn/step updates replace a prior settlement; retries add a distinct row.
        const result = !usage ? { ok: false, reason: 'invalid-usage' }
            : !Number.isFinite(ts) ? { ok: false, reason: 'missing-time' }
            : provider !== 'deepseek' ? { ok: false, reason: 'unsupported-provider' }
            : costOf(usage, model, ts, config);
        rows.set(key, { seq: event.seq ?? index, turn: d.turn, model, provider, ts, usage, result });
    }
    const totals = { hit: 0, miss: 0, out: 0, total: 0, tokensHit: 0, tokensMiss: 0, tokensOut: 0 };
    const byRate = { peak: 0, offpeak: 0 };
    const skipped = [];
    for (const row of rows.values()) {
        if (row.usage) { totals.tokensHit += row.usage.hitTokens; totals.tokensMiss += row.usage.missTokens; totals.tokensOut += row.usage.outTokens; }
        if (!row.result.ok) { skipped.push({ reason: row.result.reason, model: row.model }); continue; }
        for (const key of ['hit','miss','out','total']) totals[key] += row.result[key];
        byRate[row.result.rate] += row.result.total;
    }
    return { ok: true, totals, byRate, skipped, complete: skipped.length === 0,
        requests: rows.size, hasUsage: reported > 0, model: route.model || null,
        provider: route.provider || null, rate: rateAt(now, config), next: nextSwitch(now, config),
        pricing: config, inheritedExcluded: inherited, updatedAt: now };
}
