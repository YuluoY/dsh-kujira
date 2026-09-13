/**
 * ============================================================================
 * lib/shared/state-machine.js —— 会话事件 → 宠物档位（纯函数，零依赖）
 * ============================================================================
 *
 * 【为什么单独抽出来】
 *   这份逻辑宿主半侧和浏览器半侧都要用，而且它是最容易出 bug 的地方
 *   （中断残留、TTL 过期、多会话聚合）。抽成纯函数之后：
 *     · 宿主半侧 import 它，把事件压成快照
 *     · 浏览器半侧通过 dynamic import 加载同一份文件（宿主开路由发出去）
 *     · Node 里可以直接单测，不用开浏览器
 *   **单一来源**，不会出现"前后端各写一套、行为不一致"。
 *
 * 【核心概念：档位 + 存活期】
 *   档位不是"当前状态"，而是"一条带过期时间的通知"。超时自动回落 idle，
 *   这样状态机天然自愈 —— 进程崩了、流断了、回合被中断，都不会残留。
 *
 * 【最容易踩的坑（务必看）】
 *   任何 turn/end 事件都必须把该会话状态清掉，**不认识的 reason 一律回 null**，
 *   绝不能"保守地保留上一档"。否则回合被中断后宠物会永远卡在 working。
 *
 * 本文件不 import 任何 Node API，可在浏览器里直接运行。
 * ============================================================================
 */

// 七个档位。顺序无关紧要，优先级由 PRIORITY 决定。
export const STATE = {
    IDLE: 'idle',
    THINKING: 'thinking',
    RESULT: 'result',
    WORKING: 'working',
    SUCCESS: 'success',
    ERROR: 'error',
    WAITING: 'waiting'
};

// 全部合法档位（用于校验）。
export const STATE_LIST = [
    STATE.IDLE,
    STATE.THINKING,
    STATE.RESULT,
    STATE.WORKING,
    STATE.SUCCESS,
    STATE.ERROR,
    STATE.WAITING
];

/**
 * 聚合时的优先级：数字越大越优先。
 *
 * waiting 最高 —— 模型停下来等你，是唯一真正需要你立刻注意的状态。
 * error 次之 —— 要让你看见，但不能挂一整天。
 * success 是一次性事件，不是持续状态，所以高于工作态但不与 waiting 抢。
 */
export const PRIORITY = {
    waiting: 6,
    error: 5,
    success: 4,
    working: 3,
    result: 2,
    thinking: 1,
    idle: 0
};

/**
 * 各档位的默认存活期（毫秒）。0 = 不过期。
 *
 * 参考 Codex 官方值（openai/codex 的 pets/ambient.rs）：
 *   Running 3min / Failed 1h / Waiting 24h / Review 7d
 */
export const DEFAULT_TTL = {
    thinking: 3 * 60 * 1000,
    working: 3 * 60 * 1000,
    result: 3 * 60 * 1000,
    success: 10000,
    error: 60 * 60 * 1000,
    waiting: 24 * 60 * 60 * 1000,
    idle: 0
};

// 一次性档位：播一遍就退，不作为持续状态。
export const ONE_SHOT = new Set([STATE.SUCCESS]);

// ask_user_question 工具：模型在等用户答题，归 waiting 而不是普通工作。
export const USER_QUESTION_TOOL = 'ask_user_question';

// update_goal 工具：目标收尾轮判定用。
export const GOAL_UPDATE_TOOL = 'update_goal';

/**
 * 把 turn/end 的 reason.kind 翻译成档位。
 *
 * @param kind turn/end 的 reason.kind
 * @returns 档位字符串；返回 null 表示"该回合已结束，请把状态清掉"
 *
 * 注意：默认分支必须返回 null。这是中断自愈的关键 —— 见文件头说明。
 */
export function turnEndState(kind)
{
    if (kind === 'completed')
    {
        return STATE.SUCCESS;
    }
    if (kind === 'error' || kind === 'max-tokens' || kind === 'timeout')
    {
        return STATE.ERROR;
    }
    if (kind === 'blocked')
    {
        return STATE.WAITING;
    }

    // aborted / 未知 / 缺失 —— 一律视为"回合结束"，交由调用方清状态。
    // 绝不在这里返回上一档，否则永远卡在 working。
    return null;
}

/**
 * 解析 update_goal 的 arguments（原始 JSON 字符串），取出收尾动作。
 *
 * @param args 工具参数原始字符串
 * @returns 'complete' | 'blocked' | null
 */
export function goalUpdateAction(args)
{
    try
    {
        const obj = JSON.parse(args);
        const action = obj && obj.action;
        if (action === 'complete' || action === 'blocked')
        {
            return action;
        }
    }
    catch (error)
    {
        // 参数不是合法 JSON：按"未收尾"处理，不抛
    }
    return null;
}

/**
 * 从工具调用参数里尽量挖出一个"任务简述"，用于气泡文案。
 * 挖不到就返回 null，不猜。
 */
export function taskHintFromArgs(args)
{
    try
    {
        const obj = JSON.parse(args);
        if (!obj || typeof obj !== 'object')
        {
            return null;
        }
        for (const key of ['description', 'command', 'file_path', 'path', 'query', 'pattern'])
        {
            const v = obj[key];
            if (typeof v === 'string' && v.trim())
            {
                const s = v.trim();
                return s.length > 42 ? s.slice(0, 42) + '…' : s;
            }
        }
    }
    catch (error)
    {
        // 忽略
    }
    return null;
}

/**
 * 归一化一个会话状态记录，补上默认值与缺失字段。
 */
function normalizeSession(raw)
{
    return {
        state: STATE_LIST.includes(raw && raw.state) ? raw.state : STATE.IDLE,
        since: Number(raw && raw.since) || 0,
        ttl: typeof (raw && raw.ttl) === 'number' ? raw.ttl : 0,
        tool: (raw && raw.tool) || null,
        task: (raw && raw.task) || null,
        goalRound: Boolean(raw && raw.goalRound),
        closing: (raw && raw.closing) || null,
        title: (raw && raw.title) || null,
        playOnce: Boolean(raw && raw.playOnce)
    };
}

/**
 * 主减速器：吃一个事件，吐出该会话的新状态。
 *
 * 纯函数 —— 不读时钟（now 由调用方传入）、不改入参、无副作用。
 *
 * @param prev 该会话的上一状态（可为 null/undefined）
 * @param event DSH 的 session/event，形如 { type, data }
 * @param now 当前时间戳（ms）
 * @param ttlOf 可选的 TTL 覆盖：{ [档位]: 毫秒 }
 * @returns 新的状态记录；返回 **null** 表示清掉该会话（回空闲）
 */
export function reduceSession(prev, event, now, ttlOf)
{
    const ttl = Object.assign({}, DEFAULT_TTL, ttlOf || {});
    const before = prev ? normalizeSession(prev) : null;
    const type = event && event.type;
    const data = (event && event.data) || {};

    // 造一条新记录。
    const make = (state, extra) =>
    {
        const merged = Object.assign({
            state,
            since: now,
            ttl: ttl[state] || 0,
            tool: null,
            task: null,
            goalRound: before ? before.goalRound : false,
            closing: before ? before.closing : null,
            title: before ? before.title : null,
            playOnce: ONE_SHOT.has(state)
        }, extra || {});
        return merged;
    };

    switch (type)
    {
        case 'turn/start':
            // 新一轮开始：清掉上一轮的收尾标记
            return make(STATE.THINKING, { goalRound: false, closing: null });

        case 'tool/call':
        {
            const tool = String((data.name || data.tool || '') || '') || null;
            const args = typeof data.arguments === 'string' ? data.arguments : '';

            // 模型在等用户答题 → 归 waiting
            if (tool === USER_QUESTION_TOOL)
            {
                return make(STATE.WAITING, { tool, task: '等你回复' });
            }

            // 目标收尾工具 → 记下收尾动作，但状态仍是 working
            if (tool === GOAL_UPDATE_TOOL)
            {
                const action = goalUpdateAction(args);
                return make(STATE.WORKING, {
                    tool,
                    task: action === 'complete' ? '收尾目标' : '目标受阻',
                    closing: action || (before ? before.closing : null)
                });
            }

            return make(STATE.WORKING, { tool, task: taskHintFromArgs(args) });
        }

        case 'tool/result':
            return make(STATE.RESULT, {
                tool: before ? before.tool : null,
                task: before ? before.task : null
            });

        case 'approval/asked':
            return make(STATE.WAITING, { task: '等你确认' });

        case 'turn/end':
        {
            const kind = (data.reason && data.reason.kind) || data.kind || null;

            // 自动目标续跑的中间轮：本轮答完 ≠ 整个任务完成，不该庆祝
            if (kind === 'completed' && before && before.goalRound)
            {
                if (before.closing === 'blocked')
                {
                    return make(STATE.ERROR, { task: '目标受阻' });
                }
                if (before.closing === 'complete')
                {
                    return make(STATE.SUCCESS, { task: '目标完成' });
                }
                return make(STATE.RESULT, { task: '本轮结束' });
            }

            const state = turnEndState(kind);

            // 关键：不认识/中断的 reason 一律清状态
            if (state === null)
            {
                return null;
            }
            return make(state, { task: before ? before.task : null });
        }

        default:
            // 不关心的事件：原样返回（不做任何变化）
            return before;
    }
}

/**
 * 标记某个会话进入"目标续跑轮"。
 * 由宿主在收到 user/message 且 source.kind === 'goal' 时调用。
 */
export function markGoalRound(prev, now, ttlOf)
{
    const ttl = Object.assign({}, DEFAULT_TTL, ttlOf || {});
    if (!prev)
    {
        return null;
    }
    const next = normalizeSession(prev);
    next.goalRound = true;
    next.closing = null;
    next.since = now;
    next.ttl = ttl[next.state] || 0;
    return next;
}

/**
 * 判断一条记录是否已过期。
 * ttl 为 0 表示不过期；一次性档位也不按 TTL 淘汰（由播放逻辑处理）。
 */
export function isExpired(rec, now)
{
    if (!rec)
    {
        return true;
    }
    const ttl = Number(rec.ttl) || 0;
    if (ttl <= 0)
    {
        return false;
    }
    return now - (Number(rec.since) || 0) > ttl;
}

/**
 * 清掉过期会话。返回新的 sessions 对象（不修改入参）。
 *
 * @param sessions { [sessionId]: record }
 * @param now 当前时间戳
 * @param keepIdle 是否保留 idle 记录（默认丢弃，省内存）
 */
export function pruneExpired(sessions, now, keepIdle)
{
    const out = {};
    for (const id of Object.keys(sessions || {}))
    {
        const rec = sessions[id];
        if (isExpired(rec, now))
        {
            continue;
        }
        if (!keepIdle && rec && rec.state === STATE.IDLE)
        {
            continue;
        }
        out[id] = rec;
    }
    return out;
}

/**
 * 多会话聚合：把 N 个会话的状态压成一个"当前该显示什么"。
 *
 * @returns {
 *   state,        // 聚合后的档位
 *   count,        // 处于该档位的会话数
 *   total,        // 活跃（非 idle）会话数
 *   task, tool,   // 取自优先级最高的那个会话
 *   sessionIds    // 处于该档位的会话 id 列表（按时间倒序）
 * }
 */
export function aggregate(sessions, now, _ttlOf)
{
    const alive = pruneExpired(sessions, now, false);
    const ids = Object.keys(alive);

    if (!ids.length)
    {
        return { state: STATE.IDLE, count: 0, total: 0, task: null, tool: null, sessionIds: [] };
    }

    let best = null;
    let bestRank = -1;

    for (const id of ids)
    {
        const rec = alive[id];
        const rank = PRIORITY[rec.state] !== undefined ? PRIORITY[rec.state] : 0;
        // 同优先级时取更新的那个
        if (rank > bestRank || (rank === bestRank && best && rec.since > best.since))
        {
            best = rec;
            bestRank = rank;
        }
    }

    const state = best ? best.state : STATE.IDLE;
    const sameState = ids.filter((id) => alive[id].state === state);

    return {
        state,
        count: sameState.length,
        total: ids.length,
        task: best ? best.task : null,
        tool: best ? best.tool : null,
        goalRound: best ? best.goalRound : false,
        sessionIds: sameState.sort((a, b) => alive[b].since - alive[a].since)
    };
}

/**
 * 判断一次状态变化是否值得"播一遍"（用于一次性档位去重）。
 * 例如连续两个 tool/call 都进 working，就不该重启动画。
 */
export function shouldReplay(prevState, nextState)
{
    if (!nextState || nextState === STATE.IDLE)
    {
        return false;
    }
    if (prevState === nextState)
    {
        return false;
    }
    return true;
}
