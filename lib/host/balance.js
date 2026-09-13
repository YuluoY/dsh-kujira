/**
 * ============================================================================
 * lib/host/balance.js —— DeepSeek 账户余额（只在宿主侧发起请求）
 * ============================================================================
 *
 * 【红线】API Key 绝不进浏览器。
 *   请求在这里发出，浏览器只拿到"已经算好的结果"。所以本模块只被
 *   lib/index.js 使用，不会被打包进客户端。
 *
 * 【密钥从哪来】
 *   走 DSH 的 credentials 服务（`ctx.credentials.resolve`），不读环境变量、
 *   不读文件 —— 这样用户换密钥后下一次请求就生效，不用重启。
 *
 * 【接口】
 *   GET https://api.deepseek.com/user/balance
 *   Authorization: Bearer <DEEPSEEK_API_KEY>
 *   → { is_available, balance_infos: [{ currency, total_balance,
 *        granted_balance, topped_up_balance }] }
 *
 * 返回给浏览器的结构里**只有数字**，没有任何凭据信息。
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import { balanceTier } from '../shared/billing.js';

// 余额接口地址。
const BALANCE_URL = 'https://api.deepseek.com/user/balance';

// 单次请求超时。
const TIMEOUT_MS = 10000;

// 结果缓存时间：60 秒内复用，避免面板连点把接口打爆。
const CACHE_MS = 60000;

/**
 * 解析凭据引用。
 *
 * 优先用官方 `credentialRef()` 打标；万一该包解析不到，退回原始字符串
 * （它的 brand 在运行时不做 Symbol 校验，字符串本身就能当键用）。
 * 用 dynamic import 是为了**不让一个 import 失败拖垮整个插件加载**。
 */
async function resolveRef(name)
{
    try
    {
        const mod = await import('@deepseek-ai/dsh-credentials');
        if (mod && typeof mod.credentialRef === 'function')
        {
            return mod.credentialRef(name);
        }
    }
    catch (error)
    {
        // 包解析不到：退回裸字符串，不影响功能
    }
    return name;
}

/**
 * 取 DeepSeek API Key。取不到返回 null（不抛）。
 */
export async function resolveApiKey(ctx)
{
    try
    {
        const credentials = ctx?.credentials;
        if (!credentials || typeof credentials.resolve !== 'function') return null;
        const ref = await resolveRef('DEEPSEEK_API_KEY');
        const resolved = await credentials.resolve(ref);
        const value = resolved && resolved.value;
        return typeof value === 'string' && value.trim() ? value.trim() : null;
    }
    catch (error)
    {
        return null;
    }
}

// 把上游返回归一化成我们自己稳定的结构。
function normalize(raw)
{
    const infos = raw && Array.isArray(raw.balance_infos) ? raw.balance_infos : [];
    const num = (v) =>
    {
        if ((typeof v !== 'number' && typeof v !== 'string') || String(v).trim() === '') return NaN;
        const n = Number(v);
        return Number.isFinite(n) ? n : NaN;
    };
    const balances = infos.map(info => ({
        currency: info?.currency === 'USD' ? '$' : info?.currency === 'CNY' ? '¥' : info?.currency,
        rawCurrency: info?.currency,
        total: num(info?.total_balance),
        granted: num(info?.granted_balance),
        toppedUp: num(info?.topped_up_balance)
    }));
    if (!balances.length || balances.some(b => !b.rawCurrency || ![b.total, b.granted, b.toppedUp].every(Number.isFinite)))
    {
        return { ok: false, reason: 'bad-data', message: '余额数据不完整，请稍后刷新。' };
    }
    const first = balances[0];

    return {
        ok: true,
        available: typeof raw.is_available === 'boolean' ? raw.is_available : null,
        // Keep primary fields for existing consumers; never add different currencies.
        ...first,
        balances,
        tier: balanceTier(first.total),
        fetchedAt: Date.now()
    };
}

/**
 * 查询余额。带 60 秒缓存。
 *
 * @param ctx 插件上下文
 * @param force 跳过缓存
 * @returns 永远不会 reject —— 失败时返回 { ok:false, reason, message }
 */
export function createBalanceClient(ctx)
{
    let cache = null, identity = null, generation = 0, pending = null;

    return async function queryBalance(force)
    {
        // Resolve before reading cache: credentials may change while DSH is running.
        const key = await resolveApiKey(ctx);
        const fingerprint = key ? createHash('sha256').update(key).digest('hex') : null;
        if (identity !== fingerprint) {
            identity = fingerprint;
            generation++;
            cache = null;
            pending = null;
        }
        if (!key) return {
            ok: false, reason: 'no-key', discardPrevious: true,
            message: '没找到 DEEPSEEK_API_KEY。在 DSH 凭据里配置后即可查询余额。'
        };
        if (!force && cache && Date.now() - cache.fetchedAt < CACHE_MS)
            return {...cache, cached: true};
        if (pending) return pending;
        const current = generation;
        const job = requestBalance(key).then(out => {
            if (current !== generation) return {
                ok: false, reason: 'credentials-changed', discardPrevious: true,
                message: '账户凭据已变化，请重新查询余额。'
            };
            if (out.reason === 'http-401' || out.reason === 'http-403') cache = null;
            if (out.ok) cache = out;
            return out.ok ? out : {...out, discardPrevious: !cache};
        }).finally(() => { if (pending === job) pending = null; });
        pending = job;
        return job;
    };
}

// Keep response bodies and credentials inside the host boundary.
async function requestBalance(key)
{
    let res;
    try
    {
        res = await fetch(BALANCE_URL, {
            method: 'GET',
            headers: {
                Authorization: 'Bearer ' + key,
                Accept: 'application/json'
            },
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
    }
    catch (error)
    {
        const aborted = error && (error.name === 'AbortError' || error.name === 'TimeoutError');
        return {
            ok: false,
            reason: aborted ? 'timeout' : 'network',
            message: aborted ? '余额接口请求超时' : '余额接口连不上（检查网络或代理）'
        };
    }

    if (!res.ok)
    {
        // 注意：不要把响应体直接回给浏览器 —— 可能包含账户信息
        return {
            ok: false,
            reason: 'http-' + res.status,
            message: res.status === 401
                ? 'API Key 无效或已失效（HTTP 401）'
                : '余额接口返回 HTTP ' + res.status
        };
    }

    let body;
    try
    {
        body = await res.json();
    }
    catch (error)
    {
        return { ok: false, reason: 'bad-json', message: '余额接口返回了非 JSON 内容' };
    }

    return normalize(body);
}
