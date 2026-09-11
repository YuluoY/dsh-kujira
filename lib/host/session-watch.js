/**
 * ============================================================================
 * lib/host/session-watch.js —— 订阅 DSH 会话事件，聚合出当前状态
 * ============================================================================
 *
 * 【它做什么】
 *   监听 `session/event`，把每个会话的事件流交给纯函数状态机（lib/shared/
 *   state-machine.js）压缩成档位，最后聚合出"当前该显示什么"。
 *
 * 【为什么状态机不用在这里重写一遍】
 *   状态机是纯函数，宿主 import 它、浏览器 dynamic import 同一份文件 ——
 *   单一来源，不会出现前后端行为不一致。
 *
 * 【不调用任何模型，纯监听。】开销可以忽略。
 * ============================================================================
 */

import { reduceSession, markGoalRound, aggregate, pruneExpired } from '../shared/state-machine.js';

/**
 * 从 todo/write 事件里挖出当前正在做的任务，给气泡用。
 */
function taskFromTodo(data)
{
    const todos = data && Array.isArray(data.todos) ? data.todos : [];
    // 优先"进行中"，其次第一个未完成的
    const doing = todos.find((t) => t && t.status === 'in_progress');
    const pending = todos.find((t) => t && t.status !== 'completed');
    const hit = doing || pending;
    if (hit && typeof hit.content === 'string' && hit.content.trim())
    {
        const s = hit.content.trim();
        return s.length > 42 ? s.slice(0, 42) + '…' : s;
    }
    return null;
}

/**
 * 从会话对象里取出稳定的会话 id。
 * 不同版本可能挂在 header.id 或 id 上，都兜一下。
 */
function sessionIdOf(session)
{
    return String(
        (session && session.header && session.header.id) ||
        (session && session.id) ||
        'unknown'
    );
}

/**
 * 创建会话观察器。
 *
 * @param ctx 插件上下文（要能用 ctx.on / ctx.effect）
 * @param getTtl 返回 TTL 覆盖表的函数：() => ({ [档位]: 毫秒 })
 * @returns { snapshot(now), size(), reset() }
 */
export function createSessionWatch(ctx, getTtl)
{
    /** 会话 id → 状态记录。用 Map 而不是对象，避免原型污染与键排序问题。 */
    const sessions = new Map();

    const now = () => Date.now();

    const handle = (session, event) =>
    {
        const type = event && event.type;
        if (!type)
        {
            return;
        }

        const id = sessionIdOf(session);

        // ---- 1. 任务文案：只更新任务名，不切档位 ----
        if (type === 'todo/write')
        {
            const rec = sessions.get(id);
            if (rec)
            {
                const task = taskFromTodo(event.data);
                if (task)
                {
                    rec.task = task;
                }
            }
            return;
        }

        // ---- 2. 目标续跑轮标记：自动轮的消息带 source.kind === 'goal' ----
        if (type === 'user/message')
        {
            const kind = event.data && event.data.source && event.data.source.kind;
            if (kind === 'goal')
            {
                const prev = sessions.get(id);
                const next = markGoalRound(prev, now(), getTtl());
                if (next)
                {
                    sessions.set(id, next);
                }
            }
            return;
        }

        // ---- 3. 其余交给状态机 ----
        const prev = sessions.get(id) || null;
        const next = reduceSession(prev, event, now(), getTtl());

        if (next === null)
        {
            // 状态机明确要求清掉（回合结束 / 中断）—— 这就是中断自愈
            sessions.delete(id);
            return;
        }
        sessions.set(id, next);
    };

    ctx.effect(() =>
    {
        const dispose = ctx.on('session/event', handle);
        return () => {
            if (typeof dispose === 'function')
            {
                dispose();
            }
        };
    }, 'dsh-kujira: 会话事件 → 宠物状态');

    return {
        /** 取当前聚合快照。 */
        snapshot()
        {
            const t = now();
            // 顺手清掉过期会话，避免 Map 无限增长
            const alive = pruneExpired(Object.fromEntries(sessions), t, true);
            for (const key of Object.keys(alive))
            {
                sessions.set(key, alive[key]);
            }
            for (const key of sessions.keys())
            {
                if (!(key in alive))
                {
                    sessions.delete(key);
                }
            }
            const agg = aggregate(alive, t, getTtl());
            return Object.assign({ ts: t }, agg);
        },

        /** 当前在跟踪的会话数（诊断用）。 */
        size()
        {
            return sessions.size;
        }
    };
}
