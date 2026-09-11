/**
 * ============================================================================
 * tools/check-assets.mjs —— 素材与配置的一致性自检
 * ============================================================================
 *
 * 【为什么需要】
 *   pet.config.json 里的动作池是手写的（也可以让 AI 帮你加），很容易出现：
 *     · 池子里写了个名字，但 assets/anim/ 下没这个文件 → 播放时 404
 *     · 加了新素材入目录，但忘了加进任何池子 → 永远播不到
 *   这个脚本两边对一遍，跑一次就全清楚了。
 *
 * 【用法】
 *   npm run check
 *   # 等价于 node tools/check-assets.mjs
 *
 * 退出码 0 = 全部对得上；1 = 有问题（可直接接进 CI / pre-commit）。
 * ============================================================================
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ANIM_DIR = join(ROOT, 'assets', 'anim');
const CONFIG_FILE = join(ROOT, 'assets', 'pet.config.json');

/** 播放池以外的、单独引用的字段。 */
const SINGLE_FIELDS = ['startAnim', 'dragAnim'];

async function main()
{
    const problems = [];

    // ---- 1. 实际有的素材 ----
    let files;
    try
    {
        files = (await readdir(ANIM_DIR)).filter((f) => f.endsWith('.webm'));
    }
    catch (error)
    {
        console.error('[check] 读不到 ' + ANIM_DIR);
        console.error(String(error && error.message ? error.message : error));
        process.exit(1);
    }

    const onDisk = new Set(files.map((f) => f.slice(0, -'.webm'.length)));

    // ---- 2. 配置里引用的 ----
    const config = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
    const pools = config.pools || {};

    const referenced = new Set();
    for (const [poolName, list] of Object.entries(pools))
    {
        if (!Array.isArray(list))
        {
            problems.push('池子 ' + poolName + ' 不是数组');
            continue;
        }
        for (const name of list)
        {
            referenced.add(name);

            if (!onDisk.has(name))
            {
                problems.push('池子 ' + poolName + ' 引用了不存在的素材：' + name);
            }
        }
    }

    for (const field of SINGLE_FIELDS)
    {
        const value = config[field];
        if (!value)
        {
            problems.push('缺少字段 ' + field);
            continue;
        }
        referenced.add(value);
        if (!onDisk.has(value))
        {
            problems.push(field + ' 指向不存在的素材：' + value);
        }
    }

    // ---- 状态联动引用的动画（state.map.*.anim 与 state.enter.*）----
    const stateDef = config.state || {};
    const stateMap = stateDef.map || {};
    const stateEnter = stateDef.enter || {};

    for (const [stateName, def] of Object.entries(stateMap))
    {
        const anims = (def && def.anim) || [];
        if (!anims.length)
        {
            problems.push('state.map.' + stateName + ' 没有配动作');
        }
        for (const a of anims)
        {
            referenced.add(a);
            if (!onDisk.has(a))
            {
                problems.push('state.map.' + stateName + ' 引用了不存在的素材：' + a);
            }
        }
    }

    for (const [stateName, arr] of Object.entries(stateEnter))
    {
        if (!stateMap[stateName])
        {
            problems.push('state.enter.' + stateName + ' 在 state.map 里没有对应档位（会被忽略）');
        }
        for (const a of (Array.isArray(arr) ? arr : []))
        {
            referenced.add(a);
            if (!onDisk.has(a))
            {
                problems.push('state.enter.' + stateName + ' 引用了不存在的素材：' + a);
            }
        }
    }

    // ---- 3. 有素材但没被任何池子引用 ----
    const orphans = [...onDisk].filter((n) => !referenced.has(n));

    // ---- 4. 权重合法性 ----
    const w = config.weights || {};
    const sum = Number(w.idle || 0) + Number(w.action || 0) + Number(w.long || 0);
    if (Math.abs(sum - 1) > 0.001)
    {
        problems.push('weights.idle + action + long = ' + sum + '，应为 1');
    }

    // ---- 输出 ----
    console.log('[check] 素材目录 : ' + ANIM_DIR);
    console.log('[check] 素材文件 : ' + onDisk.size + ' 个');
    console.log('[check] 配置引用 : ' + referenced.size + ' 个（去重后）');
    console.log('');
    for (const [poolName, list] of Object.entries(pools))
    {
        console.log('  ' + poolName.padEnd(8) + String(list.length).padStart(3) + '  ' +
            (list.length <= 6 ? list.join(', ') : ''));
    }
    console.log('');

    if (orphans.length)
    {
        console.log('[warn] 有素材没进任何池子，永远播不到：');
        for (const n of orphans)
        {
            console.log('   · ' + n);
        }
        console.log('');
    }

    if (problems.length)
    {
        console.error('[fail] 发现 ' + problems.length + ' 个问题：');
        for (const p of problems)
        {
            console.error('   · ' + p);
        }
        process.exit(1);
    }

    console.log('[ok] 配置与素材完全对得上。');
}

main().catch((error) =>
{
    console.error('[check] 意外错误：' + (error && error.stack ? error.stack : error));
    process.exit(1);
});
