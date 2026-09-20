/**
 * ============================================================================
 * lib/shared/billing.js —— 三桶计费与峰谷选档（纯函数，无需网络）
 * ============================================================================
 *
 * 【为什么要分三桶】
 *   DeepSeek 的计费不是"总 token × 单价"。缓存命中比未命中便宜一到两个
 *   数量级，只算总量会**严重高估花费**。必须分开：
 *
 *     缓存命中   prompt_cache_hit_tokens    —— 便宜
 *     缓存未命中 prompt_cache_miss_tokens   —— 贵（缓存写入也按这个价计）
 *     输出       completion_tokens          —— 贵
 *
 * 【为什么要按"每条用量发生的时间"选档】
 *   高峰价是空闲价的 2 倍，而高峰/空闲按北京时间切。一次任务如果跨了
 *   换价时间点，整轮按当前档算就是错的 —— 必须逐条用量按它自己发生的
 *   时间点选档。
 *
 * 【价格会变】
 *   所以价目表放在配置里、带生效日期，不写死在代码里。本文件只提供
 *   "给定用量 + 给定价目表 → 算出钱"的纯逻辑。
 *
 * 本文件不 import 任何 Node API，可在浏览器里直接运行。
 * ============================================================================
 */

const { CHINA_HOLIDAYS } = await import('./holidays.js').catch(() => ({ CHINA_HOLIDAYS: { years: [], days: {} } }));
export { CHINA_HOLIDAYS };

// 人民币符号。
export const CURRENCY = '¥';
const BEIJING_FORMAT = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit'
});

/**
 * 取某个时间戳对应的北京时间分量。
 * 用 Intl 而不是手算时差 —— 手算会在闰秒/夏令时这类边界上出错，
 * 而且 Intl 在 Node 和浏览器里行为一致。
 *
 * @param ts 毫秒时间戳
 * @returns { weekday: 0-6（0=周日）, hour: 0-23, minute: 0-59 }
 */
export function beijingParts(ts)
{
    const fmt = BEIJING_FORMAT;

    const parts = {};
    for (const p of fmt.formatToParts(new Date(ts)))
    {
        parts[p.type] = p.value;
    }

    const WEEK = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        weekday: WEEK[parts.weekday] !== undefined ? WEEK[parts.weekday] : 0,
        // 某些实现会把 24 点给成 "24"
        hour: Number(parts.hour) % 24,
        minute: Number(parts.minute) || 0
    };
}

/**
 * 判断某个时刻是高峰还是空闲。
 *
 * 默认规则（DeepSeek 官方）：北京时间周一至周五 9:00–12:00、14:00–18:00 为高峰，
 * 中国公共假期和周末（包括周末补班）全天为空闲。
 *
 * @param ts 毫秒时间戳
 * @param cfg { peakHours: [[9,12],[14,18]], workdays: [1..5] }
 * @returns 'peak' | 'offpeak'
 */
export function rateAt(ts, cfg)
{
    const peakHours = (cfg && cfg.peakHours) || [[9, 12], [14, 18]];
    const workdays = (cfg && cfg.workdays) || [1, 2, 3, 4, 5];

    const t = beijingParts(ts);

    if (t.weekday === 0 || t.weekday === 6 || workdays.indexOf(t.weekday) < 0 ||
        (cfg?.holidayCalendar ?? CHINA_HOLIDAYS).days[t.date] === true)
    {
        return 'offpeak';
    }
    for (const [from, to] of peakHours)
    {
        if (t.hour >= from && t.hour < to)
        {
            return 'peak';
        }
    }
    return 'offpeak';
}

/**
 * 距下一次峰谷切换还有多少毫秒。用于面板显示倒计时。
 *
 * @returns { next: 'peak'|'offpeak', ms: number } —— 找不到边界时 ms 为 null
 */
export function nextSwitch(ts, cfg)
{
    const current = rateAt(ts, cfg);
    if (cfg?.peakHours?.length === 0 || cfg?.workdays?.length === 0) return { next: current, ms: null };
    // Tariff hours and Chinese calendar dates switch on Beijing hour boundaries.
    const STEP = 60 * 60 * 1000;
    for (let i = 1; i <= 370 * 24; i++)
    {
        const t = Math.floor(ts / STEP) * STEP + i * STEP;
        if (rateAt(t, cfg) !== current)
        {
            return {
                next: current === 'peak' ? 'offpeak' : 'peak',
                ms: t - ts
            };
        }
    }
    return { next: current, ms: null };
}

/**
 * 从模型名判断价格档位（价格表里的 key）。
 * 判断不出来返回 null —— 调用方应当**不估算**，而不是猜一个价格。
 */
export function priceKeyOf(model, priceTable)
{
    if (!model || typeof model !== 'string')
    {
        return null;
    }
    const m = model.toLowerCase();
    const keys = Object.keys(priceTable || {});

    for (const key of keys)
    {
        if (m.indexOf(key.toLowerCase()) >= 0)
        {
            return key;
        }
    }
    return null;
}

/**
 * 取某个时刻生效的价目。
 * 价目表按生效时间倒序排，取第一条 <= ts 的。
 *
 * @param table { [priceKey]: { hit, miss, out, effectiveFrom } }
 * @returns 价目对象，或 null（该模型没配价格 / 该时刻还没有生效的价目）
 */
export function priceAt(table, priceKey, ts)
{
    const entry = table && table[priceKey];
    if (!entry)
    {
        return null;
    }

    // 单档写法（没写 effectiveFrom）：直接用
    if (typeof entry.hit === 'number')
    {
        return entry;
    }

    // 多档写法：{ history: [{ from, hit, miss, out }] }
    const history = Array.isArray(entry.history) ? entry.history : [];
    let picked = null;
    for (const h of history)
    {
        const from = Date.parse(h.from);
        if (!Number.isFinite(from) || from <= ts)
        {
            if (!picked || Date.parse(h.from) > Date.parse(picked.from))
            {
                picked = h;
            }
        }
    }
    return picked;
}

/**
 * 算一条用量的花费。
 *
 * @param usage { hitTokens, missTokens, outTokens, cacheWriteTokens }
 * @param model 模型名（用于选价格档）
 * @param ts 这条用量**发生**的时间戳（不是算钱的时间）
 * @param cfg 计费配置 { prices, peakHours, workdays, peakMultiplier }
 * @returns {
 *   ok, reason?,            // ok=false 时 reason 说明为什么没算
 *   rate,                   // 'peak' | 'offpeak'
 *   currency, hit, miss, out, total
 * }
 */
export function costOf(usage, model, ts, cfg)
{
    const conf = cfg || {};
    const table = conf.prices || {};
    const mult = conf.peakMultiplier || 2;

    const priceKey = priceKeyOf(model, table);
    if (!priceKey)
    {
        return { ok: false, reason: 'unknown-model', model: model || null };
    }

    const price = priceAt(table, priceKey, ts);
    if (!price)
    {
        return { ok: false, reason: 'no-price', model, priceKey };
    }

    const rate = rateAt(ts, conf);
    const k = rate === 'peak' ? mult : 1;

    // 每百万 token 的单价
    const hit = (Number(usage.hitTokens) || 0) / 1e6 * (Number(price.hit) || 0) * k;
    // 缓存写入按未命中价计 —— DeepSeek 没有独立的"缓存写入"计费类目
    const miss = ((Number(usage.missTokens) || 0) + (Number(usage.cacheWriteTokens) || 0)) / 1e6 * (Number(price.miss) || 0) * k;
    const out = (Number(usage.outTokens) || 0) / 1e6 * (Number(price.out) || 0) * k;

    return {
        ok: true,
        rate,
        priceKey,
        model,
        currency: CURRENCY,
        hit,
        miss,
        out,
        total: hit + miss + out,
        tokens: {
            hit: Number(usage.hitTokens) || 0,
            miss: Number(usage.missTokens) || 0,
            out: Number(usage.outTokens) || 0
        }
    };
}

/**
 * 汇总一批用量。每条按自己的时间戳选档 —— 这是"跨峰谷也算得准"的关键。
 *
 * @param entries [{ usage, model, ts }]
 * @returns {
 *   ok, totals: { hit, miss, out, total, tokensHit, tokensMiss, tokensOut },
 *   byRate: { peak: {...}, offpeak: {...} },
 *   skipped: [{ reason, model }]   // 没算进去的（未知模型/无价目）
 * }
 */
export function sumCost(entries, cfg)
{
    const totals = { hit: 0, miss: 0, out: 0, total: 0, tokensHit: 0, tokensMiss: 0, tokensOut: 0 };
    const byRate = {
        peak: { cost: 0, tokens: 0 },
        offpeak: { cost: 0, tokens: 0 }
    };
    const skipped = [];

    for (const e of entries || [])
    {
        const r = costOf(e.usage, e.model, e.ts, cfg);
        if (!r.ok)
        {
            skipped.push({ reason: r.reason, model: r.model });
            continue;
        }
        totals.hit += r.hit;
        totals.miss += r.miss;
        totals.out += r.out;
        totals.total += r.total;
        totals.tokensHit += r.tokens.hit;
        totals.tokensMiss += r.tokens.miss;
        totals.tokensOut += r.tokens.out;

        const bucket = byRate[r.rate] || byRate.offpeak;
        bucket.cost += r.total;
        bucket.tokens += r.tokens.hit + r.tokens.miss + r.tokens.out;
    }

    return { ok: true, totals, byRate, skipped, hasPrice: skipped.length === 0 || totals.total > 0 };
}

/**
 * 把金额格式化成便于阅读的字符串。
 * 小额保留 4 位小数（不然 ¥0.0032 会显示成 ¥0.00 看不出来）。
 */
export function money(n)
{
    const v = Number(n) || 0;
    if (v === 0)
    {
        return CURRENCY + '0';
    }
    if (Math.abs(v) < 0.01)
    {
        return CURRENCY + v.toFixed(4);
    }
    if (Math.abs(v) < 1)
    {
        return CURRENCY + v.toFixed(3);
    }
    return CURRENCY + v.toFixed(2);
}

/**
 * 把 token 数格式化成 K / M。
 */
export function tokens(n)
{
    const v = Number(n) || 0;
    if (v >= 1e6)
    {
        return (v / 1e6).toFixed(2) + 'M';
    }
    if (v >= 1e3)
    {
        return (v / 1e3).toFixed(1) + 'K';
    }
    return String(v);
}

/**
 * 余额档位：把绝对金额折算成 5 档措辞。
 * 不直接甩数字 —— 一是档位更好读，二是截图时不会泄露金额（配合 UI 开关）。
 *
 * @param total 余额
 * @param thresholds [告急, 偏紧, 正常, 充裕] 的下界
 */
export function balanceTier(total, thresholds)
{
    const t = thresholds || [5, 20, 100, 500];
    const v = Number(total) || 0;

    if (v < t[0])
    {
        return { tier: 'empty', label: '已见底' };
    }
    if (v < t[1])
    {
        return { tier: 'tight', label: '偏紧' };
    }
    if (v < t[2])
    {
        return { tier: 'normal', label: '正常' };
    }
    if (v < t[3])
    {
        return { tier: 'good', label: '充裕' };
    }
    return { tier: 'rich', label: '很充裕' };
}
