/**
 * ============================================================================
 * tools/rename.mjs —— 改项目名（保证 7 处耦合点不会改漏）
 * ============================================================================
 *
 * 【为什么需要这个脚本】
 *   插件名在 DSH 里不是一个字符串，而是**散落在好几个地方**，且彼此必须严格一致。
 *   改漏任何一处都不会报错 —— 插件只是静默地不工作，很难查：
 *
 *     ① package.json          name                  —— 包名，身份
 *     ② cordis.patch.yml      name                  —— 模块名，必须能解析到 ①
 *     ③ cordis.patch.yml      id                    —— 配置树里的行 id，全局唯一
 *     ④ lib/index.js          export const name     —— Cordis loader 诊断用
 *     ⑤ lib/client.js         __ModuleLoader__.load({ id })  —— **必须 === ①**
 *     ⑥ lib/index.js          ROUTE_PREFIX          —— 宿主侧资源路由
 *     ⑦ lib/client.js         ASSET_BASE            —— 前端侧资源路由，必须 === ⑥
 *
 *   （另有 lib/client.js 的 POS_KEY 也跟着名字走，用来隔离 localStorage。）
 *
 *   这 7 个地方手工改迟早会漏，所以做成脚本。
 *
 * 【两种替换】
 *   · 长的在前：先换 `<旧名>`（如 dsh-xxx），再换短的 entry id `xxx`。
 *     顺序反了会得到 `dsh-kujira-kujira` 这种结果。
 *   · 功能行先做「存在性校验」—— 文件结构一旦变过（比如有人重写了导出写法），
 *     立刻报错，而不是静默留下一个半改状态。
 *   · 校验通过后做**全量替换**，把注释和文档里的旧名也一并换掉，
 *     免得留下误导性的旧说明。
 *
 * 【用法】
 *   node tools/rename.mjs dsh-kujira            # 只改名字
 *   node tools/rename.mjs dsh-kujira --dir      # 顺便把项目目录也改名
 * ============================================================================
 */

import { readFile, writeFile, rename, access } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const newName = args.find((a) => !a.startsWith('--'));
const alsoRenameDir = args.includes('--dir');

/** 当前的配置树行 id —— 从 cordis.patch.yml 实际读出来，不硬编码。
 *  否则改过第二次名字之后，这个常量就过期了。 */
async function readCurrentEntryId()
{
    const text = await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8');
    // 剔掉注释行，只看真正生效的部分。
    // 注意 YAML 里这一行是列表项：`  - id: xxx`，前面有个 `-`。
    const body = text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    const m = body.match(/^\s*-?\s*id:\s*(\S+)/m);
    if (!m)
    {
        fail('cordis.patch.yml 里找不到生效的 id 行');
    }
    return m[1];
}

function fail(message)
{
    console.error('[rename] ' + message);
    process.exit(1);
}

/**
 * 校验是否符合 npm 包名规则。
 *
 * 注：本插件刻意不使用 `@scope/name` 形式 —— DSH 会按包名拼出
 * `/plugins/<name>/client.js` 这个 URL，带斜杠的 scoped name 有编码风险，
 * 而且无法确认宿主会怎么处理。保持无 scope。
 */
function validate(name)
{
    if (!name)
    {
        fail('用法：node tools/rename.mjs <新名字> [--dir]');
    }
    if (name.length > 214)
    {
        fail('名字太长');
    }
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name))
    {
        fail('只能用小写字母、数字、点、下划线、连字符，且必须以字母或数字开头');
    }
    if (name === 'node_modules' || name === 'favicon.ico')
    {
        fail('这个名字被 npm 保留');
    }
}

/**
 * 改一个文件。
 *
 * @param relPath     相对项目根的路径
 * @param mustHave    功能行的存在性校验表：[{ find: string|RegExp, label }]
 * @param replacements 全量替换表：[{ from, to }]，顺序敏感（长的在前）
 */
async function patchFile(relPath, mustHave, replacements)
{
    const file = join(ROOT, relPath);
    let text = await readFile(file, 'utf8');

    // ---- 第 1 步：功能行存在性校验 ----
    for (const { find, label } of mustHave)
    {
        const found = typeof find === 'string' ? text.includes(find) : find.test(text);
        if (!found)
        {
            fail(relPath + ' 里找不到 ' + label + ' 的旧值 —— 文件结构可能变过，请手工核对：' +
                (typeof find === 'string' ? JSON.stringify(find) : String(find)));
        }
    }

    // ---- 第 2 步：全量替换 ----
    let count = 0;
    for (const { from, to } of replacements)
    {
        const hit = text.split(from).length - 1;
        if (hit > 0)
        {
            text = text.split(from).join(to);
            count += hit;
        }
    }

    await writeFile(file, text, 'utf8');
    console.log('  ok   ' + relPath.padEnd(22) + count + ' 处');
}

async function main()
{
    validate(newName);

    const pkgRaw = await readFile(join(ROOT, 'package.json'), 'utf8');
    const oldName = JSON.parse(pkgRaw).name;

    if (oldName === newName)
    {
        console.log('[rename] 名字已经是 ' + newName + '，无需改动。');
        return;
    }

    const newId = newName.replace(/^dsh-/, '');
    const newRoute = '/' + newName;
    const OLD_ENTRY_ID = await readCurrentEntryId();

    console.log('');
    console.log('[rename] ' + oldName + '  →  ' + newName);
    console.log('         配置树行 id   ' + OLD_ENTRY_ID + '  →  ' + newId);
    console.log('         资源路由      /' + oldName + '  →  ' + newRoute);
    console.log('');

    // 长名在前：否则短名会先吃掉长名的一部分
    const REPLACE = [
        { from: oldName, to: newName },
        { from: OLD_ENTRY_ID, to: newId }
    ];

    // ① package.json
    await patchFile('package.json',
        [{ find: '"name": "' + oldName + '"', label: 'name' }],
        REPLACE);

    // ②③ cordis.patch.yml
    await patchFile('cordis.patch.yml',
        [
            { find: "name: '" + oldName + "'", label: 'name' },
            { find: 'id: ' + OLD_ENTRY_ID, label: 'id' }
        ],
        REPLACE);

    // ④⑥ lib/index.js
    await patchFile('lib/index.js',
        [
            { find: "export const name = '" + oldName + "'", label: 'export name' },
            { find: "ROUTE_PREFIX = '/" + oldName + "'", label: 'ROUTE_PREFIX' }
        ],
        REPLACE);

    // ⑤⑦ lib/client.js
    await patchFile('lib/client.js',
        [
            { find: "id: '" + oldName + "'", label: 'ModuleLoader id' },
            { find: "ASSET_BASE = '/" + oldName + "'", label: 'ASSET_BASE' },
            { find: "const name = '" + OLD_ENTRY_ID + "'", label: 'export name' }
        ],
        REPLACE);

    // README —— 纯文档，只全量替换，不做存在性校验
    await patchFile('README.md', [], REPLACE);

    // tools/ 下的脚本与预览页 —— 名字只出现在注释和文案里，同样只做全量替换
    for (const rel of ['tools/preview.html', 'tools/preview-server.mjs', 'tools/check-assets.mjs', 'assets/pet.config.json'])
    {
        await patchFile(rel, [], REPLACE);
    }

    // ---- 项目目录改名 ----
    let finalRoot = ROOT;
    if (alsoRenameDir)
    {
        const currentDir = basename(ROOT);
        if (currentDir !== newName)
        {
            const target = join(dirname(ROOT), newName);
            try
            {
                await access(target);
                fail('目标目录已存在，无法改名：' + target);
            }
            catch (error)
            {
                if (error && error.code !== 'ENOENT')
                {
                    throw error;
                }
            }
            await rename(ROOT, target);
            finalRoot = target;
            console.log('  ok   项目目录改名  ' + currentDir + ' →  ' + newName);
        }
    }

    console.log('');
    console.log('[rename] 改完了。重新安装到 DSH（profile 里记的还是旧包名）：');
    console.log('');
    console.log('    dsh plugin --profile web remove ' + oldName);
    console.log('    dsh plugin --profile web add link:' + finalRoot);
    console.log('');
    console.log('  然后跑自检确认没改坏：');
    console.log('    cd ' + finalRoot);
    console.log('    node tools/check-assets.mjs');
    console.log('    node tools/test-host.mjs');
    console.log('');
}

main().catch((error) =>
{
    console.error('[rename] 意外错误：' + (error && error.stack ? error.stack : error));
    process.exit(1);
});
