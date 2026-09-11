/**
 * ============================================================================
 * tools/test-logic.mjs —— 纯逻辑单测（不用开浏览器、不用起 DSH）
 * ============================================================================
 *
 * 覆盖三块最容易出 bug 的纯函数：
 *   · state-machine.js  事件 → 档位（尤其"中断自愈"和 TTL）
 *   · billing.js        三桶计费 + 峰谷选档
 *   · growth.js         墙钟衰减 + 等级
 *
 * 用法：npm run test:logic   （等价于 node tools/test-logic.mjs）
 * 退出码 0 = 全过；1 = 有条目失败。
 * ============================================================================
 */

import * as SM from '../lib/shared/state-machine.js';
import * as BILL from '../lib/shared/billing.js';
import * as GROW from '../lib/shared/growth.js';
import * as ARC from '../lib/shared/arc.js';

let pass = 0;
let fail = 0;

function eq(actual, expected, label)
{
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e)
    {
        pass++;
        console.log('  [ok]   ' + label);
    }
    else
    {
        fail++;
        console.log('  [FAIL] ' + label);
        console.log('         期望 ' + e);
        console.log('         实际 ' + a);
    }
}

function ok(cond, label, detail)
{
    if (cond)
    {
        pass++;
        console.log('  [ok]   ' + label);
    }
    else
    {
        fail++;
        console.log('  [FAIL] ' + label + (detail ? '   ' + detail : ''));
    }
}

function section(title)
{
    console.log('');
    console.log('── ' + title + ' ' + '─'.repeat(Math.max(0, 58 - title.length)));
}

// ============================================================================
// 时间锚点（2026-09-11 是周五）
// ============================================================================
const T_FRI_1000 = Date.parse('2026-09-11T10:00:00+08:00');   // 周五上午高峰
const T_FRI_1300 = Date.parse('2026-09-11T13:00:00+08:00');   // 周五午休空闲
const T_FRI_1500 = Date.parse('2026-09-11T15:00:00+08:00');   // 周五下午高峰
const T_SAT_1000 = Date.parse('2026-09-12T10:00:00+08:00');   // 周六（周末全天空闲）

// ============================================================================
section('state-machine · 事件 → 档位');
// ============================================================================
{
    const e = (type, data) => ({ type, data });

    eq(SM.reduceSession(null, e('turn/start'), 1000).state, 'thinking', 'turn/start → thinking');
    eq(SM.reduceSession(null, e('tool/call', { name: 'bash' }), 2000).state, 'working', 'tool/call → working');
    eq(SM.reduceSession(null, e('tool/call', { name: 'bash' }), 2000).tool, 'bash', 'tool/call 记下工具名');
    eq(SM.reduceSession(null, e('tool/result'), 3000).state, 'result', 'tool/result → result');
    eq(SM.reduceSession(null, e('approval/asked'), 4000).state, 'waiting', 'approval/asked → waiting');

    // ask_user_question 是"等你答题"，不是普通工作
    eq(SM.reduceSession(null, e('tool/call', { name: 'ask_user_question' }), 5000).state,
        'waiting', 'ask_user_question → waiting（不是 working）');

    // turn/end 的各分支
    eq(SM.reduceSession(null, e('turn/end', { reason: { kind: 'completed' } }), 6000).state,
        'success', 'turn/end(completed) → success');
    eq(SM.reduceSession(null, e('turn/end', { reason: { kind: 'error' } }), 7000).state,
        'error', 'turn/end(error) → error');
    eq(SM.reduceSession(null, e('turn/end', { reason: { kind: 'max-tokens' } }), 8000).state,
        'error', 'turn/end(max-tokens) → error');
    eq(SM.reduceSession(null, e('turn/end', { reason: { kind: 'timeout' } }), 9000).state,
        'error', 'turn/end(timeout) → error');
    eq(SM.reduceSession(null, e('turn/end', { reason: { kind: 'blocked' } }), 10000).state,
        'waiting', 'turn/end(blocked) → waiting');
}

// ============================================================================
section('state-machine · 中断自愈（最容易出 bug 的一条）');
// ============================================================================
{
    const e = (type, data) => ({ type, data });
    const working = SM.reduceSession(null, e('tool/call', { name: 'bash' }), 1000);

    eq(working.state, 'working', '先进入 working');

    // 中断：必须返回 null（= 清掉状态），不能保留 working
    eq(SM.reduceSession(working, e('turn/end', { reason: { kind: 'aborted' } }), 2000),
        null, 'turn/end(aborted) → null（清状态）');

    // 完全不认识的 reason：同样必须清掉，不能"保守保留"
    eq(SM.reduceSession(working, e('turn/end', { reason: { kind: '某个未来才有的值' } }), 2000),
        null, 'turn/end(未知 reason) → null（不许残留 working）');

    // reason 整个缺失
    eq(SM.reduceSession(working, e('turn/end', {}), 2000),
        null, 'turn/end(无 reason) → null');

    ok(SM.turnEndState('completed') === 'success' &&
       SM.turnEndState('error') === 'error' &&
       SM.turnEndState('aborted') === null &&
       SM.turnEndState(undefined) === null,
        'turnEndState 的默认分支返回 null');
}

// ============================================================================
section('state-machine · 目标续跑轮（不该提前庆祝）');
// ============================================================================
{
    const e = (type, data) => ({ type, data });
    let s = SM.reduceSession(null, e('turn/start'), 1000);
    s = SM.markGoalRound(s, 1500);

    // 中间轮 completed → result（不是 success）
    eq(SM.reduceSession(s, e('turn/end', { reason: { kind: 'completed' } }), 2000).state,
        'result', '目标中间轮 completed → result（不庆祝）');

    // 收尾轮 complete → success
    let s2 = SM.reduceSession(null, e('turn/start'), 1000);
    s2 = SM.markGoalRound(s2, 1500);
    s2 = SM.reduceSession(s2, e('tool/call', { name: 'update_goal', arguments: '{"action":"complete"}' }), 1800);
    eq(s2.closing, 'complete', 'update_goal(action=complete) 记下收尾动作');
    eq(SM.reduceSession(s2, e('turn/end', { reason: { kind: 'completed' } }), 2000).state,
        'success', '目标收尾轮 complete → success（该庆祝）');

    // 收尾轮 blocked → error（诚实，不庆祝）
    let s3 = SM.markGoalRound(SM.reduceSession(null, e('turn/start'), 1000), 1500);
    s3 = SM.reduceSession(s3, e('tool/call', { name: 'update_goal', arguments: '{"action":"blocked"}' }), 1800);
    eq(SM.reduceSession(s3, e('turn/end', { reason: { kind: 'completed' } }), 2000).state,
        'error', '目标收尾轮 blocked → error');

    // 非法 JSON 不该抛
    eq(SM.goalUpdateAction('这不是 json'), null, 'update_goal 参数是非法 JSON → null（不抛）');
}

// ============================================================================
section('state-machine · TTL 与多会话聚合');
// ============================================================================
{
    const e = (type, data) => ({ type, data });
    const rec = SM.reduceSession(null, e('tool/call', { name: 'bash' }), 1000);

    eq(SM.isExpired(rec, 1000 + 60 * 1000), false, 'working 1 分钟后未过期');
    eq(SM.isExpired(rec, 1000 + 4 * 60 * 1000), true, 'working 4 分钟后过期（TTL 3min）');

    // waiting 的 TTL 更长
    const w = SM.reduceSession(null, e('approval/asked'), 1000);
    eq(SM.isExpired(w, 1000 + 3600 * 1000), false, 'waiting 1 小时后未过期（TTL 24h）');
    eq(SM.isExpired(w, 1000 + 25 * 3600 * 1000), true, 'waiting 25 小时后过期');

    // 聚合优先级：waiting > error > working
    const now = 100000;
    const sessions = {
        a: SM.reduceSession(null, e('tool/call', { name: 'bash' }), now),
        b: SM.reduceSession(null, e('turn/end', { reason: { kind: 'error' } }), now),
        c: SM.reduceSession(null, e('approval/asked'), now)
    };
    const agg = SM.aggregate(sessions, now + 100);
    eq(agg.state, 'waiting', '多会话聚合取优先级最高的（waiting 胜出）');
    eq(agg.total, 3, '聚合统计到 3 个会话');
    eq(agg.count, 1, 'waiting 只有 1 个');

    // 各自的 TTL 不同，过期是逐条发生的：
    //   working 3min / error 1h / waiting 24h
    const at5min = SM.aggregate(sessions, now + 5 * 60 * 1000);
    eq(at5min.total, 2, '5 分钟后：只有 working 过期，剩 error + waiting');
    eq(at5min.state, 'waiting', '5 分钟后仍是 waiting 优先');

    const at2h = SM.aggregate(sessions, now + 2 * 3600 * 1000);
    eq(at2h.total, 1, '2 小时后：working 与 error 都过期，只剩 waiting');
    eq(at2h.state, 'waiting', '2 小时后还是 waiting');

    const at25h = SM.aggregate(sessions, now + 25 * 3600 * 1000);
    eq(at25h.state, 'idle', '25 小时后（超过最长 TTL）全部过期 → 回 idle');
    eq(at25h.total, 0, '全部过期后活跃会话数为 0');
}

// ============================================================================
section('billing · 峰谷判定');
// ============================================================================
{
    eq(BILL.rateAt(T_FRI_1000, {}), 'peak', '周五 10:00 → 高峰');
    eq(BILL.rateAt(T_FRI_1300, {}), 'offpeak', '周五 13:00 → 空闲');
    eq(BILL.rateAt(T_FRI_1500, {}), 'peak', '周五 15:00 → 高峰');
    eq(BILL.rateAt(T_SAT_1000, {}), 'offpeak', '周六 10:00 → 空闲（周末全天）');
    eq(BILL.beijingParts(T_FRI_1000).weekday, 5, '2026-09-11 是周五');
}

// ============================================================================
section('billing · 三桶计费');
// ============================================================================
{
    // 造一张简单价目表：命中 0.1 / 未命中 1 / 输出 4（元每百万 token）
    const cfg = {
        peakMultiplier: 2,
        prices: { flash: { hit: 0.1, miss: 1, out: 4 } }
    };

    // 空闲时段：每种各 1M token
    const off = BILL.costOf(
        { hitTokens: 1e6, missTokens: 1e6, outTokens: 1e6 },
        'deepseek-v4-flash', T_FRI_1300, cfg);
    ok(off.ok, '空闲时段算得出来');
    eq(Math.round(off.hit * 100) / 100, 0.1, '空闲 · 缓存命中 1M → 0.1');
    eq(Math.round(off.miss * 100) / 100, 1, '空闲 · 未命中 1M → 1');
    eq(Math.round(off.out * 100) / 100, 4, '空闲 · 输出 1M → 4');
    eq(Math.round(off.total * 100) / 100, 5.1, '空闲 · 合计 5.1');

    // 高峰：全部 ×2
    const peak = BILL.costOf(
        { hitTokens: 1e6, missTokens: 1e6, outTokens: 1e6 },
        'deepseek-v4-flash', T_FRI_1000, cfg);
    eq(Math.round(peak.total * 100) / 100, 10.2, '高峰 · 合计 10.2（空闲的 2 倍）');

    // 缓存写入按未命中价计
    const cw = BILL.costOf(
        { hitTokens: 0, missTokens: 0, cacheWriteTokens: 1e6, outTokens: 0 },
        'deepseek-v4-flash', T_FRI_1300, cfg);
    eq(Math.round(cw.miss * 100) / 100, 1, '缓存写入 1M 按未命中价 → 1');

    // 未知模型：宁可不报，也不猜
    const unknown = BILL.costOf({ outTokens: 1e6 }, 'gpt-5', T_FRI_1300, cfg);
    eq(unknown.ok, false, '未知模型不估算');
    eq(unknown.reason, 'unknown-model', '未知模型给出 reason=unknown-model');
}

// ============================================================================
section('billing · 跨峰谷的会话（按每条用量发生时间选档）');
// ============================================================================
{
    const cfg = {
        peakMultiplier: 2,
        prices: { flash: { hit: 0, miss: 1, out: 0 } }
    };

    const sum = BILL.sumCost([
        { usage: { missTokens: 1e6 }, model: 'x-flash', ts: T_FRI_1000 },   // 高峰 → 2
        { usage: { missTokens: 1e6 }, model: 'x-flash', ts: T_FRI_1300 },   // 空闲 → 1
        { usage: { missTokens: 1e6 }, model: 'x-flash', ts: T_FRI_1500 }    // 高峰 → 2
    ], cfg);

    eq(Math.round(sum.totals.total * 100) / 100, 5, '跨峰谷合计 5（2+1+2，不是按当前档统一算）');
    eq(Math.round(sum.byRate.peak.cost * 100) / 100, 4, '高峰部分合计 4');
    eq(Math.round(sum.byRate.offpeak.cost * 100) / 100, 1, '空闲部分合计 1');
}

// ============================================================================
section('billing · 格式化与档位');
// ============================================================================
{
    eq(BILL.money(0), '¥0', 'money(0)');
    eq(BILL.money(0.0032), '¥0.0032', '很小的金额保留 4 位（不然看不出）');
    eq(BILL.money(3.21), '¥3.21', '普通金额保留 2 位');
    eq(BILL.tokens(1234567), '1.23M', 'token 大写 M');
    eq(BILL.tokens(1200), '1.2K', 'token 大写 K');

    eq(BILL.balanceTier(1).tier, 'empty', '余额 1 → 已见底');
    eq(BILL.balanceTier(10).tier, 'tight', '余额 10 → 偏紧');
    eq(BILL.balanceTier(50).tier, 'normal', '余额 50 → 正常');
    eq(BILL.balanceTier(200).tier, 'good', '余额 200 → 充裕');
    eq(BILL.balanceTier(900).tier, 'rich', '余额 900 → 很充裕');
}

// ============================================================================
section('growth · 墙钟时间衰减');
// ============================================================================
{
    const H = 3600 * 1000;
    let n = GROW.createState(0);

    // 8 小时不管、也没在工作
    const r = GROW.tick(n, 8 * H, { workingMs: 0 });
    eq(Math.round(r.state.satiety), 0, '8 小时后饱食见底（100 - 8×12.5）');
    eq(Math.round(r.state.mood), 0, '8 小时后心情见底');
    ok(r.state.energy > 0, '空闲时精力是回复的，不会见底', 'energy=' + Math.round(r.state.energy));

    // 1 小时全在干活：精力掉 25
    let m = GROW.createState(0);
    const w = GROW.tick(m, 1 * H, { workingMs: 1 * H });
    eq(Math.round(w.state.energy), 75, '连续工作 1 小时 → 精力 100-25=75');

    // 时间倒流（改了系统时间）不该补算，只把基准拨回来
    const back = GROW.tick(GROW.createState(10000), 5000, {});
    eq(back.elapsedMs, 0, '时间倒流 → elapsedMs 归零，不补算');
}

// ============================================================================
section('growth · 好感只涨不掉 + 等级');
// ============================================================================
{
    const now = Date.now();
    let n = GROW.createState(now);

    n = GROW.applyGain(n, { bond: 50 }, now, {}).state;
    eq(n.bond, 50, '好感 +50');
    n = GROW.applyGain(n, { bond: -999 }, now, {}).state;
    eq(n.bond, 50, '负数好感不会让它下降（只涨不掉）');

    eq(GROW.levelOf(0, {}), 1, '好感 0 → Lv1');
    eq(GROW.levelOf(60, {}), 2, '好感 60 → Lv2');
    eq(GROW.levelOf(199, {}), 2, '好感 199 → 仍是 Lv2');
    eq(GROW.levelOf(200, {}), 3, '好感 200 → Lv3');
    eq(GROW.levelOf(99999, {}), 7, '好感拉满 → Lv7（封顶）');

    const lv = GROW.applyGain(GROW.createState(now), { bond: 200 }, now, {});
    ok(lv.leveledUp, '跨阈值时 leveledUp=true');
    eq(lv.level, 3, '跨到 Lv3');

    const nxt = GROW.toNextLevel(0, {});
    eq(nxt.need, 60, '距下一级还差 60');
    eq(GROW.toNextLevel(99999, {}), null, '满级后没有下一级');
}

// ============================================================================
section('growth · 成就与需求提示');
// ============================================================================
{
    const now = Date.now();
    const defs = [
        { id: 'turn-10', name: '十轮', stat: 'turns', gte: 10 },
        { id: 'days-3', name: '三天', days: 3 }
    ];

    let n = GROW.createState(now);
    let r = GROW.checkAchievements(n, defs, now);
    eq(r.unlocked, [], '刚创建时没有成就');

    n = GROW.applyGain(n, { stat: { turns: 10 } }, now, {}).state;
    r = GROW.checkAchievements(n, defs, now);
    eq(r.unlocked, ['turn-10'], '完成 10 个回合 → 解锁对应成就');

    // 重复检查不该重复解锁
    r = GROW.checkAchievements(r.state, defs, now + 1000);
    eq(r.unlocked, [], '同一个成就不会重复解锁');

    eq(GROW.describeNeed({ satiety: 10, mood: 90 }).key, 'satiety', '饱食低 → 提示饿了');
    eq(GROW.describeNeed({ satiety: 90, mood: 90, energy: 90 }), null, '数值都高 → 不打扰');
}

// ============================================================================
// arc · 功能按钮的圆弧扩散布局
// ============================================================================

section('arc · 角度 → 屏幕位移');

// 屏幕 y 轴向下，所以「向上」必须是负位移 —— 这个符号漏掉的话，
// 整个弧线会上下翻转，而且在小视口上才看得出来，很难发现。
{
    const up = ARC.degToOffset(90, 100);
    eq([Math.round(up.x), Math.round(up.y)], [0, -100], '90° → 正上（y 取负）');

    const left = ARC.degToOffset(180, 100);
    eq([Math.round(left.x), Math.round(left.y)], [-100, 0], '180° → 正左');

    const right = ARC.degToOffset(0, 100);
    eq([Math.round(right.x), Math.round(right.y)], [100, 0], '0° → 正右');

    const tl = ARC.degToOffset(135, 100);
    ok(tl.x < 0 && tl.y < 0, '135° → 左上（两轴都为负）', 'x=' + tl.x.toFixed(1) + ' y=' + tl.y.toFixed(1));
}

section('arc · 槽位均分');

{
    const s4 = ARC.arcSlots({ count: 4, centerDeg: 135, spanDeg: 72, radius: 200 });

    eq(s4.length, 4, '4 枚 → 4 个槽位');
    eq(s4.map((s) => Math.round(s.deg)), [99, 123, 147, 171], '中间等分，端点落在中心 ± 跨度/2');

    // 「弧」的定义就是半径恒定；有人改成线性插值的话这里会立刻红
    const radii = s4.map((s) => Math.round(Math.hypot(s.x, s.y)));
    eq(radii, [200, 200, 200, 200], '所有槽位都在同一半径上');

    const s1 = ARC.arcSlots({ count: 1, centerDeg: 135, spanDeg: 72, radius: 200 });
    eq(s1[0].deg, 135, '只有 1 枚时退化为中心角（不除零）');

    const s0 = ARC.arcSlots({ count: 0, centerDeg: 135, spanDeg: 72, radius: 200 });
    eq(s0.length, 1, '数量异常时至少给 1 个，不返回空数组');
}

section('arc · 自适应跨度（spanForCount）');

{
    // 4 枚按钮时必须和旧行为完全一致 —— 否则现有手感就变了
    eq(ARC.spanForCount({ count: 4, stepDeg: 24, maxSpanDeg: 96 }), 72, '4 枚 → 72°（与旧版一致）');

    eq(ARC.spanForCount({ count: 1, stepDeg: 24, maxSpanDeg: 96 }), 0, '1 枚 → 0°（arcSlots 有居中特判）');
    eq(ARC.spanForCount({ count: 2, stepDeg: 24, maxSpanDeg: 96 }), 24, '2 枚 → 一个角距');
    eq(ARC.spanForCount({ count: 5, stepDeg: 24, maxSpanDeg: 96 }), 96, '5 枚 → 96°，不超上限');
    eq(ARC.spanForCount({ count: 9, stepDeg: 24, maxSpanDeg: 96 }), 96, '9 枚 → 被上限封住（分页前的兜底）');

    // 封顶之后角距被压缩，但均分不变 —— 用槽位角度验证
    const s5 = ARC.arcSlots({ count: 5, centerDeg: 135, spanDeg: ARC.spanForCount({ count: 5, stepDeg: 24, maxSpanDeg: 96 }), radius: 200 });
    eq(s5.map((s) => Math.round(s.deg)), [87, 111, 135, 159, 183], '5 枚仍严格均分、中心对称');

    // 非法输入兜底，不出 NaN
    ok(Number.isFinite(ARC.spanForCount({ count: 'x', stepDeg: NaN, maxSpanDeg: 0 })), '非法输入 → 仍返回有限数');
}

section('arc · 分页（sliceArcPage）');

{
    // 不超过一页容量：一页放完，没有「更多」
    const few = ARC.sliceArcPage({ total: 4, page: 0, pageSize: 5 });
    eq(few, { pageCount: 1, page: 0, start: 0, end: 4, hasMore: false }, '4 个功能 → 单页全展示');

    const full = ARC.sliceArcPage({ total: 5, page: 0, pageSize: 5 });
    eq(full, { pageCount: 1, page: 0, start: 0, end: 5, hasMore: false }, '恰好 5 个 → 仍然单页（不需要「更多」占位）');

    // 超出后每页让出一格给「更多」：pageSize 5 → 每页 4 枚真按钮
    const p0 = ARC.sliceArcPage({ total: 7, page: 0, pageSize: 5 });
    eq(p0, { pageCount: 2, page: 0, start: 0, end: 4, hasMore: true }, '7 个 → 第 1 页 4 枚 + 更多');

    const p1 = ARC.sliceArcPage({ total: 7, page: 1, pageSize: 5 });
    eq(p1, { pageCount: 2, page: 1, start: 4, end: 7, hasMore: true }, '7 个 → 第 2 页 3 枚 + 更多');

    // 页码越界要取模归一：循环翻页依赖这条
    eq(ARC.sliceArcPage({ total: 7, page: 2, pageSize: 5 }).page, 0, '页码越过末页 → 回到首页');
    eq(ARC.sliceArcPage({ total: 7, page: -1, pageSize: 5 }).page, 1, '负页码 → 末页');

    // 页与页之间不重不漏（9 个功能、每页 4 枚真按钮 → 3 页）
    const probe = ARC.sliceArcPage({ total: 9, page: 0, pageSize: 5 });
    eq(probe.pageCount, 3, '9 个 → 3 页');

    const seen = [];
    for (let i = 0; i < probe.pageCount; i += 1)
    {
        const s = ARC.sliceArcPage({ total: 9, page: i, pageSize: 5 });
        for (let j = s.start; j < s.end; j += 1) { seen.push(j); }
    }
    eq(seen, [0, 1, 2, 3, 4, 5, 6, 7, 8], '9 个功能分 3 页 → 不重不漏');
}

section('arc · 错位延迟');

{
    eq(ARC.staggerDelays({ count: 4, staggerMs: 32, dir: 'in' }), [0, 32, 64, 96], '入场：从第一枚开始递延');

    // 退场反向是刻意的：两个方向同序会显得机械。这条容易被「顺手统一」掉
    eq(ARC.staggerDelays({ count: 4, staggerMs: 24, dir: 'out' }), [72, 48, 24, 0], '退场：反向，最后出现的先走');

    eq(ARC.staggerDelays({ count: 1, staggerMs: 32, dir: 'out' }), [0], '单枚无延迟');
    eq(ARC.staggerDelays({ count: 4, staggerMs: 0, dir: 'in' }), [0, 0, 0, 0], '间隔为 0 时全部同时出场');
}

section('arc · 越界检测');

{
    // 宠物贴右下角、视口充裕 —— 左上扇面完全放得下
    const corner = { left: 1150, top: 640, width: 260, height: 260 };
    const view = { vw: 1440, vh: 900 };

    eq(ARC.arcOverflow({ rect: corner, centerDeg: 135, spanDeg: 72, radius: 200, ...view }), 0,
        '贴右下角 + 左上弧 → 零越界');

    ok(ARC.arcOverflow({ rect: corner, centerDeg: -90, spanDeg: 72, radius: 200, ...view }) > 0,
        '同样位置弧朝下 → 探出底边');

    // 视口比宠物还小：怎么摆都越界
    ok(ARC.arcOverflow({ rect: { left: 20, top: 20, width: 260, height: 260 }, centerDeg: 135, spanDeg: 72, radius: 200, vw: 420, vh: 420 }) > 0,
        '小视口 → 检测到越界');
}

section('arc · 朝向自动选择');

{
    const view = { vw: 1440, vh: 900 };

    const corner = ARC.pickArcCenter({
        rect: { left: 1150, top: 640, width: 260, height: 260 },
        spanDeg: 72,
        radius: 200,
        ...view
    });
    eq(corner.key, 'tl', '贴右下角 → 选左上');
    eq(corner.overflow, 0, '且零越界');

    // 宠物被拖到贴近顶部：左上放不下，必须让位
    const nearTop = { left: 1150, top: 20, width: 260, height: 260 };
    const picked = ARC.pickArcCenter({ rect: nearTop, spanDeg: 72, radius: 200, ...view });
    const forcedTl = ARC.arcOverflow({ rect: nearTop, centerDeg: 135, spanDeg: 72, radius: 200, ...view });

    ok(picked.key !== 'tl', '贴顶部 → 不再选左上', '实际选了 ' + picked.key);
    ok(picked.overflow < forcedTl, '挑出来的朝向确实比左上好',
        picked.overflow.toFixed(1) + ' < ' + forcedTl.toFixed(1));

    // 屏幕正中间：左上仍然可用
    const center = ARC.pickArcCenter({
        rect: { left: 590, top: 320, width: 260, height: 260 },
        spanDeg: 72, radius: 200, ...view
    });
    eq(center.overflow, 0, '屏幕中央 → 能找到零越界的朝向');
}

section('arc · 半径');

{
    eq(ARC.orbRadius(260, 0), 180, 'size 260 自动 → 180（实测外缘 0.58×260 + 29）');
    ok(ARC.orbRadius(360, 0) > ARC.orbRadius(260, 0), '宠物越大，扇面越开');
    eq(ARC.orbRadius(100, 0), 96, '小宠物被下限托住');
    eq(ARC.orbRadius(600, 0), 377, '大宠物随尺寸放大');
    eq(ARC.orbRadius(260, 210), 210, '显式指定时以指定值为准');

    // 尺寸无效（0 / NaN / undefined）不该产生 NaN，而是退回默认宠物尺寸下的半径
    eq(ARC.orbRadius(0, 0), 180, '尺寸异常 → 退回默认 260 的半径');
    eq(ARC.orbRadius(undefined, 0), 180, '尺寸缺失 → 同上');
    ok(Number.isFinite(ARC.orbRadius(NaN, 0)), 'NaN 也不会污染出 NaN');

    // 按钮内缘（弧半径 - 按钮半径 17）任何尺寸下都不压人物素材的最坏外缘。
    // 这条是本公式的立身之本：有人调 PET_EXTENT / ORB_GAP 时这里立刻红。
    for (const size of [80, 120, 260, 360, 600])
    {
        const inner = ARC.orbRadius(size, 0) - 17;
        ok(inner >= size * ARC.PET_EXTENT - 0.5,
            '按钮内缘不压人物最坏外缘（size ' + size + '）',
            Math.round(inner) + 'px ≥ ' + Math.round(size * ARC.PET_EXTENT) + 'px');
    }

    // 最挤形态（最小半径 + 满页 5 枚 + 封顶跨度 96°）相邻按钮视觉上不重叠
    {
        const slots = ARC.arcSlots({ count: 5, centerDeg: 135, spanDeg: 96, radius: 96 });
        const gaps = slots.slice(1).map((sl, i) => Math.hypot(sl.x - slots[i].x, sl.y - slots[i].y));
        ok(Math.min(...gaps) > 34, '最挤时相邻按钮也不叠', gaps.map((g) => Math.round(g)).join(' / '));
    }

    ok(ARC.DEFAULT_SPAN_DEG === 66, '默认跨度 66°');

    // ---- 视口收缩 ----
    eq(ARC.fitRadius(180, { w: 1440, h: 900 }), 180, '宽视口 → 不动原值');
    eq(ARC.fitRadius(180, { w: 640, h: 800 }), 180, '640 宽 → 理想半径放得下，不收缩');
    eq(ARC.fitRadius(180, { w: 480, h: 760 }), 180, '480 宽 → 192 ≥ 180，不收缩');
    eq(ARC.fitRadius(180, { w: 400, h: 720 }), 160, '400 宽 → 160（DSH 侧边面板场景）');
    eq(ARC.fitRadius(180, { w: 200, h: 200 }), 120, '极窄视口 → 被下限托住');
    eq(ARC.fitRadius(100, { w: 1440, h: 900 }), 100, '原值本来就小 → 不动它');
    ok(Number.isFinite(ARC.fitRadius(NaN, { w: 500, h: 500 })), 'NaN 不污染结果');
    ok(Number.isFinite(ARC.fitRadius(180, null)), '视口参数缺失时也不崩');

    // 收缩后的半径要真的放得下：弧的最远点 + 外侧标签不能顶出视口
    for (const vp of [{ w: 1440, h: 900 }, { w: 640, h: 800 }, { w: 480, h: 760 }, { w: 400, h: 720 }])
    {
        const r = ARC.fitRadius(ARC.orbRadius(260, 0), vp);
        const limit = Math.max(ARC.MIN_FIT_R, Math.min(vp.w, vp.h) * ARC.FIT_RATIO);

        ok(r <= limit + 0.5, '收缩后不超过视口短边的 40%（' + vp.w + '）', r + 'px ≤ ' + Math.round(limit) + 'px');
    }
}

section('arc · 气泡面板落位（panelPlacement）');

{
    // 1440 视口 · 宠物贴在右下角（right:24, size:260）→ 左侧可用 1156px
    const wide = ARC.panelPlacement({ rect: { left: 1156, right: 1416, width: 260 }, viewport: { w: 1440, h: 900 } });
    eq(wide.side, 1, '默认落在舞台左侧（尾巴朝右指向她）');
    eq(wide.width, 272, '宽视口 → 理想宽度 272');
    eq(wide.pull, 0, '宽视口 → 内缘锚在舞台框边缘，不往里让');
    eq(wide.tail, 24, '宽视口 → 尾巴全长 24px');
    ok(wide.pull + wide.tail < ARC.PET_TAIL_ROW_EDGE, '尾巴尖停在她外缘之外',
        (wide.pull + wide.tail) + 'px < ' + ARC.PET_TAIL_ROW_EDGE + 'px');

    // 460（DSH 侧边面板常见宽度）→ 左侧只剩 176px
    const narrow = ARC.panelPlacement({ rect: { left: 176, right: 436, width: 260 }, viewport: { w: 460, h: 760 } });
    eq(narrow.side, 1, '这一侧仍然更宽 → 不换边');
    eq(narrow.width, ARC.PANEL_MIN_W, '放不下理想宽度 → 收窄到下限 188');
    eq(narrow.pull, 24, '贴住视口左缘留白 12px（188 + 12 - 176）');
    ok(narrow.pull + narrow.tail <= ARC.PET_TAIL_ROW_EDGE, '尾巴尖仍然不戳到她',
        (narrow.pull + narrow.tail) + 'px ≤ ' + ARC.PET_TAIL_ROW_EDGE + 'px');
    // 尾巴挪到「气泡右下角」之后，它落在最底下那一带（她最坏 53px），
    // 余量比躯干那一行宽裕，窄视口往里挤 24px 也够 —— 不该被挤短。
    eq(narrow.tail, ARC.PANEL_TAIL, '贴边 24px 之后尾巴仍是全长（底部余量足够）');

    // 宠物被拖到视口左缘：这一侧放不下 → 翻到另一侧（尾巴跟着换向）
    const flip = ARC.panelPlacement({ rect: { left: 20, right: 280, width: 260 }, viewport: { w: 1440, h: 900 } });
    eq(flip.side, -1, '左侧放不下 → 翻到右侧');
    eq(flip.width, 272, '换边后拿回理想宽度');
    eq(flip.pull, 0, '换边后不需要往里让');

    // 两侧都放不下（极窄）：仍要给出可用数值，不能是 NaN，也不能把尾巴退化没
    const tiny = ARC.panelPlacement({ rect: { left: 60, right: 320, width: 260 }, viewport: { w: 380, h: 700 } });
    ok(tiny.width >= ARC.PANEL_MIN_W, '极窄视口 → 宽度不低于下限', tiny.width + 'px');
    ok(tiny.tail >= ARC.PANEL_TAIL_MIN, '极窄视口 → 尾巴仍有下限长度', tiny.tail + 'px');
    ok(Number.isFinite(tiny.pull) && tiny.pull >= 0, '极窄视口 → pull 有效', String(tiny.pull));

    // 参数缺失不崩（模块加载失败时就会走到这条路径）
    const junk = ARC.panelPlacement({ rect: null, viewport: null });
    ok(Number.isFinite(junk.width) && Number.isFinite(junk.pull) && Number.isFinite(junk.tail),
        '参数缺失 → 给出兜底值而不是 NaN', JSON.stringify(junk));

    // 不变量：只要「挤进来的距离 + 尾巴全长」还在底部那一带的余量之内，
    // 尾巴就该保持那副自然的样子（不被挤短），同时尾巴尖不越过她外缘。
    let worst = 0;
    let shortened = 0;
    for (let vw = 320; vw <= 1920; vw += 20)
    {
        const p = ARC.panelPlacement({ rect: { left: vw - 284, right: vw - 24, width: 260 }, viewport: { w: vw, h: 900 } });

        if (p.pull + ARC.PANEL_TAIL <= ARC.PET_TAIL_ROW_EDGE)
        {
            worst = Math.max(worst, p.pull + p.tail);

            if (p.tail !== ARC.PANEL_TAIL)
            {
                shortened += 1;
            }
        }
    }
    ok(worst <= ARC.PET_TAIL_ROW_EDGE && shortened === 0,
        '扫 320~1920：放得下时尾巴保持全长，且尾巴尖始终在她外缘之内',
        '最坏 ' + worst + 'px ≤ ' + ARC.PET_TAIL_ROW_EDGE + 'px，被挤短 ' + shortened + ' 次');
}

section('arc · 总时长');

{
    const total = ARC.totalDuration({ count: 4, staggerMs: 32, durationMs: 285 });
    eq(total, 381, '4 枚 · 32ms 间隔 · 285ms → 381ms');
    ok(total < 700, '整套在 700ms 以内（动效规范的硬上限）');
}

// ============================================================================
console.log('');
console.log('═══════════════════════════════════════════════════════');
if (fail === 0)
{
    console.log('  [ok] ' + pass + ' 项全部通过');
    process.exit(0);
}
console.error('  [fail] ' + fail + ' 项失败，' + pass + ' 项通过');
process.exit(1);
