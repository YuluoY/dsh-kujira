/**
 * ============================================================================
 * lib/shared/growth.js —— 养成数值（纯函数，零依赖）
 * ============================================================================
 *
 * 【三条设计铁律】
 *
 *  ① 衰减用**墙钟时间**，不是运行时长。
 *     关掉浏览器 8 小时回来，饱食度就该掉了满格 —— 否则养成不成立。
 *     实现上存 lastTickAt 时间戳，每次 tick 按 now - lastTickAt 一次性补算，
 *     而不是开定时器慢慢减。
 *
 *  ② 衰减只影响**表达**，不影响**可用性**。
 *     她饿了会多说两句、动作慢一点，但绝不拒绝响应点击。
 *     Tamagotchi 那套"不喂就不理你"在开发者工具里是负体验。
 *
 *  ③ 好感只涨不掉。
 *     减少焦虑。等级阈值稀疏（7 级），每级解锁的东西要能被感知到。
 *
 * 本文件不 import 任何 Node API，可在浏览器里直接运行。
 * ============================================================================
 */

/** 当前数据模型版本。改结构时 +1，配套写迁移。 */
export const STATE_VERSION = 1;

/** 数值上下限。 */
export const MIN = 0;
export const MAX = 100;

/** 默认衰减/回复速率（每小时）。 */
export const DEFAULT_RATES = {
    satietyPerHour: 100 / 8,      // 8 小时见底
    moodPerHour: 100 / 6,         // 6 小时见底
    energyWorkPerHour: 25,        // 工作中每小时消耗
    energyIdlePerHour: 8          // 空闲时每小时回复
};

/**
 * 等级阈值（好感度下界）。Lv1 起步，共 7 级。
 * 阈值刻意稀疏 —— 频繁升级会让"升级"这件事失去意义。
 */
export const DEFAULT_LEVELS = [0, 60, 200, 500, 1100, 2200, 4000];

/** 等级解锁内容（用于 UI 展示"下一级解锁什么"）。 */
export const LEVEL_UNLOCKS = {
    2: '新的待机小动作',
    3: '多一句随机台词',
    4: '新的点击回应',
    5: '称号「鲸汐守护者」',
    6: '深夜专属台词',
    7: '隐藏彩蛋'
};

/**
 * 造一份初始数值。
 */
export function createState(now, overrides)
{
    return Object.assign({
        v: STATE_VERSION,
        mood: 80,
        satiety: 80,
        energy: 100,
        bond: 0,
        lastTickAt: now,
        firstSeenAt: now,
        stats: {
            turns: 0,          // 完成的回合数
            workingMs: 0,      // 累计工作时长
            companionMs: 0,    // 累计陪伴时长
            pats: 0,           // 被点击次数
            feeds: 0,          // 被投喂次数
            drags: 0,          // 被拖动次数
            tokens: 0,         // 累计消耗 token
            activeDays: []     // 活跃日期（YYYY-MM-DD，北京时区）
        },
        unlocked: {}           // 已解锁成就：{ [id]: 时间戳 }
    }, overrides || {});
}

/** 数值夹取。 */
function clamp01(v)
{
    const n = Number(v);
    if (!Number.isFinite(n))
    {
        return 0;
    }
    return Math.max(MIN, Math.min(MAX, n));
}

/** 夹取经过的时长（防止损坏的时间戳算出几十年）。 */
function clampElapsed(v, max)
{
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0)
    {
        return 0;
    }
    return Math.min(n, max);
}

/** 取北京时区的 YYYY-MM-DD。 */
export function beijingDay(ts)
{
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    return fmt.format(new Date(ts));
}

/** 取北京时区的小时（0-23）。 */
export function beijingHour(ts)
{
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
        hour: '2-digit'
    });
    return Number(fmt.format(new Date(ts))) % 24;
}

/**
 * 补算衰减与回复。
 *
 * @param n 当前数值状态
 * @param now 当前时间戳
 * @param opts { workingMs } 上次 tick 至今的"宠物处于工作态"的毫秒数
 * @param rates 速率覆盖
 * @returns { state, elapsedMs, deltas, leveledUp, unlocked }
 */
export function tick(n, now, opts, rates)
{
    const r = Object.assign({}, DEFAULT_RATES, rates || {});
    const state = Object.assign({}, n, { stats: Object.assign({}, n.stats) });

    // 注意：不能用 `Number(x) || now` —— 时间戳 0 是合法值，会被 falsy 判断吃掉，
    //   导致 elapsedMs 归零、衰减完全不生效。必须用 Number.isFinite 判。
    const lastRaw = Number(state.lastTickAt);
    const last = Number.isFinite(lastRaw) ? lastRaw : now;

    // 超过 30 天没打开：按 30 天算。避免时间戳损坏时算出几十年的衰减。
    const MAX_ELAPSED = 30 * 24 * 3600 * 1000;
    const elapsedMs = clampElapsed(now - last, MAX_ELAPSED);

    // 时间倒流（改了系统时间/时区）：只把基准拨回来，不补算
    if (elapsedMs <= 0)
    {
        state.lastTickAt = now;
        return { state, elapsedMs: 0, deltas: { mood: 0, satiety: 0, energy: 0, bond: 0 }, unlocked: [] };
    }

    const hours = elapsedMs / 3600000;
    const optsIn = opts || {};
    // 工作时长不能超过总时长（调用方可能传脏数据）
    const workingMs = Math.max(0, Math.min(elapsedMs, Number(optsIn.workingMs) || 0));
    const workingHours = workingMs / 3600000;
    const idleHours = Math.max(0, hours - workingHours);

    const before = { mood: state.mood, satiety: state.satiety, energy: state.energy, bond: state.bond };

    state.satiety = clamp01(state.satiety - hours * r.satietyPerHour);
    state.mood = clamp01(state.mood - hours * r.moodPerHour);
    state.energy = clamp01(state.energy - workingHours * r.energyWorkPerHour + idleHours * r.energyIdlePerHour);

    // 累计统计
    state.stats.workingMs += workingMs;
    state.stats.companionMs += elapsedMs;

    // 记活跃日（只留最近 60 天，避免无限增长）
    const local = new Date(now);
    const day = [local.getFullYear(),String(local.getMonth()+1).padStart(2,'0'),String(local.getDate()).padStart(2,'0')].join('-');
    if (state.stats.activeDays.indexOf(day) < 0)
    {
        state.stats.activeDays.push(day);
        if (state.stats.activeDays.length > 60)
        {
            state.stats.activeDays = state.stats.activeDays.slice(-60);
        }
    }

    state.lastTickAt = now;

    return {
        state,
        elapsedMs,
        deltas: {
            mood: state.mood - before.mood,
            satiety: state.satiety - before.satiety,
            energy: state.energy - before.energy,
            bond: 0
        },
        unlocked: []
    };
}

/**
 * 加事件点数（好感/心情等），并按需升级。
 *
 * @param n 数值状态
 * @param gain { bond, mood, satiety, energy, stat } —— stat 是 stats 里的计数器名
 * @param now 时间戳
 * @param cfg { levels }
 */
export function applyGain(n, gain, now, cfg)
{
    const conf = cfg || {};
    const levels = conf.levels || DEFAULT_LEVELS;

    const state = Object.assign({}, n, { stats: Object.assign({}, n.stats) });
    const g = gain || {};

    if (typeof g.bond === 'number' && g.bond > 0)
    {
        // 好感**只涨不掉**：负数与非正数一律忽略。
        // （想清零请另写重置逻辑，不要靠传负值）
        state.bond = Math.max(0, Number(state.bond) || 0) + g.bond;
    }
    if (typeof g.mood === 'number')
    {
        state.mood = clamp01(state.mood + g.mood);
    }
    if (typeof g.satiety === 'number')
    {
        state.satiety = clamp01(state.satiety + g.satiety);
    }
    if (typeof g.energy === 'number')
    {
        state.energy = clamp01(state.energy + g.energy);
    }
    if (g.stat)
    {
        for (const k of Object.keys(g.stat))
        {
            state.stats[k] = (Number(state.stats[k]) || 0) + g.stat[k];
        }
    }

    const beforeLevel = levelOf(n.bond, cfg);
    const afterLevel = levelOf(state.bond, cfg);

    return {
        state,
        level: afterLevel,
        leveledUp: afterLevel > beforeLevel,
        levelName: levelName(afterLevel),
        nextUnlock: LEVEL_UNLOCKS[afterLevel + 1] || null
    };
}

/**
 * 由好感度算等级（1 起）。
 */
export function levelOf(bond, cfg)
{
    const levels = (cfg && cfg.levels) || DEFAULT_LEVELS;
    const b = Number(bond) || 0;
    let lv = 1;
    for (let i = 0; i < levels.length; i++)
    {
        if (b >= levels[i])
        {
            lv = i + 1;
        }
    }
    return lv;
}

/** 等级称号。 */
export function levelName(lv)
{
    const names = ['初见', '熟悉', '常伴', '默契', '信赖', '鲸汐守护者', '同行者'];
    return names[Math.min(names.length - 1, Math.max(0, (lv || 1) - 1))];
}

/**
 * 距下一级还需要多少好感；已满级返回 null。
 */
export function toNextLevel(bond, cfg)
{
    const levels = (cfg && cfg.levels) || DEFAULT_LEVELS;
    const b = Number(bond) || 0;
    for (const t of levels)
    {
        if (b < t)
        {
            return { need: t - b, at: t };
        }
    }
    return null;
}

/**
 * 检查成就解锁。
 *
 * 成就用声明式定义（配置里能写），所以不放函数：
 *   { id, name, desc, stat, gte, days }
 *     stat + gte  —— 某个计数器达到阈值
 *     days         —— 活跃天数达到阈值（用 stats.activeDays.length）
 *
 * @returns { unlocked: string[], state } —— state 已带上新解锁的成就
 */
export function checkAchievements(n, defs, now)
{
    const state = Object.assign({}, n, { unlocked: Object.assign({}, n.unlocked) });
    const unlocked = [];

    for (const def of defs || [])
    {
        if (!def || !def.id || state.unlocked[def.id])
        {
            continue;
        }

        let hit = false;
        if (typeof def.days === 'number')
        {
            hit = (state.stats.activeDays || []).length >= def.days;
        }
        else if (def.stat)
        {
            hit = (Number(state.stats[def.stat]) || 0) >= (Number(def.gte) || 0);
        }

        if (hit)
        {
            state.unlocked[def.id] = now;
            unlocked.push(def.id);
        }
    }

    return { unlocked, state };
}

/**
 * 生成一句状态描述，给气泡用。
 */
export function describeNeed(n)
{
    const s = n || {};
    if (Number(s.satiety) < 20)
    {
        return { key: 'satiety', text: '有点饿了…' };
    }
    if (Number(s.mood) < 20)
    {
        return { key: 'mood', text: '今天有点提不起劲' };
    }
    if (Number(s.energy) < 20)
    {
        return { key: 'energy', text: '陪跑了这么久，有点累' };
    }
    return null;
}

/**
 * 迁移旧版本数据。目前只有 v1，占位以便以后扩展。
 */
export function migrate(raw, now)
{
    if (!raw || typeof raw !== 'object')
    {
        return createState(now);
    }
    const base = createState(now);
    const merged = Object.assign(base, raw);
    merged.stats = Object.assign(base.stats, raw.stats || {});
    merged.unlocked = Object.assign({}, raw.unlocked || {});
    merged.v = STATE_VERSION;
    return merged;
}
