/**
 * ============================================================================
 * tools/test-host.mjs —— 宿主半侧的离线自检（不用启动 DSH）
 * ============================================================================
 *
 * 【怎么做到的】
 *   lib/index.js 导出的 apply(ctx, config) 只依赖 ctx 上的两个东西：
 *     ctx.effect(fn)                  —— 注册副作用，卸载时回收
 *     ctx.webServer.register(route)   —— 注册 HTTP 路由，返回注销函数
 *   所以给一个假的 ctx 就能把真实的路由处理器抠出来，再用假的 req/res
 *   调它，完整验证路由逻辑 —— 不需要真的起 DSH。
 *
 * 【覆盖点】
 *   1. config.json 能取到，且是合法 JSON、字段齐全
 *   2. anim/<名字>.webm 能取到，content-type / 长度正确
 *   3. URL 编码的中文文件名（含空格、括号）能正确解码
 *   4. 目录穿越攻击被挡（../../ 之类）
 *   5. 不存在的文件返回 404，未知子路径返回 404
 *
 * 【用法】
 *   npm run test:host
 *   # 等价于 node tools/test-host.mjs
 *
 * 退出码 0 = 全过；1 = 有条目失败。
 * ============================================================================
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { readdir } from 'node:fs/promises';
import { apply, name, inject } from '../lib/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED_DIR = join(ROOT, 'lib', 'shared');

/**
 * 把 apply 注册的路由抠出来，并顺便统计它订阅了哪些事件。
 *
 * 假 ctx 必须提供 apply() 实际用到的一切：
 *   effect       —— 注册副作用
 *   webServer    —— 注册路由
 *   on           —— 订阅 session/event（会话状态联动用）
 *   credentials  —— 取 API Key（余额用）；这里给一个"没配密钥"的实现
 *                   ——别给真密钥，测试不该碰用户的凭据
 */
async function collectRoutes()
{
    const routes = [];
    const disposes = [];
    const events = [];

    const ctx = {
        effect(fn)
        {
            const dispose = fn();
            if (typeof dispose === 'function')
            {
                disposes.push(dispose);
            }
            return dispose;
        },
        on(event, handler)
        {
            events.push({ event, handler });
            return () => {};
        },
        webServer: {
            register(route)
            {
                routes.push(route);
                return () => {};
            }
        },
        credentials: {
            async resolve()
            {
                return undefined;   // 模拟"未配置密钥"
            },
            async describe()
            {
                return { configured: false, writable: false };
            }
        }
    };

    apply(ctx, { size: 260, realtime: { enabled: false } });

    return {
        routes,
        events,
        dispose: () => disposes.forEach((d) => d())
    };
}

/**
 * 造一个假的响应对象。
 *
 * 关键点：必须是一个真正的 stream.Writable —— 因为宿主半侧用
 * `createReadStream(file).pipe(res)` 发动画，pipe 要求目标可写流具备
 * write / end / on / emit / once 这一整套。如果只糊一个带 write()
 * 的普通对象，pipe 会直接抛错，测出来的就是假阴性。
 */
function fakeRes()
{
    const chunks = [];

    const res = new Writable({
        write(chunk, encoding, callback)
        {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            callback();
        }
    });

    res.status = 0;
    res.headers = null;

    res.writeHead = (status, headers) =>
    {
        res.status = status;
        res.headers = headers || {};
        return res;
    };

    Object.defineProperty(res, 'body', {
        get: () => Buffer.concat(chunks)
    });
    Object.defineProperty(res, 'text', {
        get: () => Buffer.concat(chunks).toString('utf8')
    });

    return res;
}

/**
 * 调一次路由，等响应真正结束。
 * 用 'finish' 事件收尾 —— 无论是 res.end() 还是 stream.pipe(res) 都会触发它。
 */
function call(handler, url, method = 'GET')
{
    const req = { url, method };
    const res = fakeRes();

    return new Promise((resolve) =>
    {
        let settled = false;
        const done = () =>
        {
            if (settled)
            {
                return;
            }
            settled = true;
            resolve(res);
        };

        res.on('finish', done);
        res.on('close', done);
        // 兜底：handler 只 writeHead 不 end 的情况（比如流断了），别把测试挂死
        setTimeout(done, 8000);

        Promise.resolve(handler(req, res)).catch((error) =>
        {
            if (!res.headersSent)
            {
                res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
                res.end('handler threw: ' + error.message);
            }
            else
            {
                res.destroy();
            }
            done();
        });
    });
}

/** 简单的断言收集器。 */
const results = [];
function check(title, ok, detail)
{
    results.push({ title, ok, detail });
    console.log('  ' + (ok ? '[ok]  ' : '[FAIL]') + title + (detail ? '   ' + detail : ''));
}

async function main()
{
    console.log('[test-host] 插件名: ' + name + ' | inject: ' + JSON.stringify(inject));
    console.log('');

    const { routes } = await collectRoutes();

    check('apply() 注册了路由', routes.length > 0, routes.map((r) => r.path).join(', '));
    if (!routes.length)
    {
        process.exit(1);
    }

    const route = routes[0];
    // 路由前缀不硬编码：直接取插件实际注册的那个，改名后测试不用跟着改
    const PREFIX = route.path;
    check('路由类型是 prefix', route.kind === 'prefix', 'kind=' + route.kind);
    check("路由前缀是 '/' + name", route.path === '/' + name, route.path);
    console.log('');

    // ---- 1. config.json ----
    {
        const res = await call(route.handler, PREFIX + '/config.json');
        let parsed = null;
        let parseError = '';
        try
        {
            parsed = JSON.parse(res.text);
        }
        catch (error)
        {
            parseError = error.message;
        }

        check('GET /config.json 返回 200', res.status === 200, 'status=' + res.status);
        check('content-type 是 JSON', /application\/json/.test(res.headers?.['content-type'] || ''),
            res.headers?.['content-type']);
        check('内容是合法 JSON', parsed !== null, parseError);
        check('响应带 no-store（保证改完刷新即生效）',
            /no-store/.test(res.headers?.['cache-control'] || ''), res.headers?.['cache-control']);

        if (parsed)
        {
            const pools = parsed.pools || {};
            const total = Object.values(pools).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0);
            check('配置里有动作池', total > 0,
                Object.keys(pools).map((k) => k + ':' + pools[k].length).join(' '));
            check('startAnim 存在', typeof parsed.startAnim === 'string' && parsed.startAnim.length > 0,
                parsed.startAnim);
            check('size 是数字', typeof parsed.size === 'number', String(parsed.size));
        }
    }

    // ---- 2. 中文文件名（含空格与全角括号）----
    {
        const plain = '待机呼吸休闲';
        const tricky = '点击回应 - 开心跃动';
        const parens = '被吓一跳（炸毛）';

        for (const anim of [plain, tricky, parens])
        {
            const url = PREFIX + '/anim/' + encodeURIComponent(anim) + '.webm';
            const res = await call(route.handler, url);
            check('GET 动画「' + anim + '」', res.status === 200 && res.body.length > 0,
                'status=' + res.status + ' size=' + res.body.length);
        }

        // webm 魔数校验：前 4 字节应为 EBML 头 1A 45 DF A3
        const res = await call(route.handler, PREFIX + '/anim/' + encodeURIComponent(plain) + '.webm');
        const magic = res.body.slice(0, 4);
        check('返回的是真 WebM（EBML 魔数）',
            magic[0] === 0x1a && magic[1] === 0x45 && magic[2] === 0xdf && magic[3] === 0xa3,
            magic.toString('hex'));
        check('content-type 是 video/webm',
            (res.headers?.['content-type'] || '') === 'video/webm', res.headers?.['content-type']);
    }

    // ---- 3. 目录穿越 ----
    {
        const attacks = [
            PREFIX + '/anim/../../../../../../etc/passwd',
            PREFIX + '/anim/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
            PREFIX + '/anim/..%2f..%2fpackage.json'
        ];
        for (const a of attacks)
        {
            const res = await call(route.handler, a);
            check('挡掉穿越：' + a.slice(0, 52), res.status === 400 || res.status === 404,
                'status=' + res.status);
        }
    }

    // ---- 4. 不存在 / 未知路径 ----
    {
        const res404 = await call(route.handler, PREFIX + '/anim/' + encodeURIComponent('根本不存在的动画') + '.webm');
        check('不存在的动画返回 404', res404.status === 404, 'status=' + res404.status);

        const resUnknown = await call(route.handler, PREFIX + '/whatever');
        check('未知子路径返回 404', resUnknown.status === 404, 'status=' + resUnknown.status);
    }

    // ---- 5. 会话事件订阅 ----
    {
        const se = (await collectRoutes()).events.filter((e) => e.event === 'session/event');
        check('订阅了 session/event', se.length > 0, se.length + ' 个处理器');
    }

    // ---- 6. 纯逻辑模块路由（浏览器 dynamic import 用）----
    {
        // 直接遍历目录，而不是写死名单 —— 否则往 lib/shared/ 加了新文件、
        // 忘了同步宿主里的 SHARED_ALLOW，测试还是全绿，但浏览器会拿到 404，
        // 那块功能静默退化成默认值，非常难查。
        const onDisk = (await readdir(SHARED_DIR)).filter((f) => f.endsWith('.js'));

        check('lib/shared/ 下确实有模块', onDisk.length > 0, onDisk.length + ' 个: ' + onDisk.join(', '));

        for (const mod of onDisk)
        {
            const res = await call(route.handler, PREFIX + '/shared/' + mod);
            check('GET /shared/' + mod + ' 可下载',
                res.status === 200 && res.body.length > 0,
                'status=' + res.status + ' size=' + res.body.length);
        }

        const one = await call(route.handler, PREFIX + '/shared/state-machine.js');
        check('/shared/* 的 MIME 是 ES 模块',
            (one.headers?.['content-type'] || '').indexOf('javascript') >= 0,
            one.headers?.['content-type']);
        check('/shared/* 不缓存（改了立刻生效）',
            /no-store/.test(one.headers?.['cache-control'] || ''), one.headers?.['cache-control']);

        // 白名单：请求没在名单里的模块必须被拒
        const bad = await call(route.handler, PREFIX + '/shared/../../package.json');
        check('白名单挡住 /shared/ 的越权访问', bad.status === 404 || bad.status === 400, 'status=' + bad.status);

        const bad2 = await call(route.handler, PREFIX + '/shared/secret.js');
        check('白名单挡住未登记的模块名', bad2.status === 404, 'status=' + bad2.status);
    }

    // ---- 7. 状态快照 ----
    {
        const res = await call(route.handler, PREFIX + '/state');
        let j = null;
        try
        {
            j = JSON.parse(res.text);
        }
        catch (error)
        {
            // 下面会报出来
        }
        check('GET /state 返回 200', res.status === 200, 'status=' + res.status);
        check('/state 是合法 JSON', j !== null);
        check('/state 初始状态是 idle', j && j.state === 'idle', j ? j.state : '');
        check('/state 带 ok 与跟踪数', Boolean(j && j.ok === true && typeof j.tracking === 'number'),
            j ? 'tracking=' + j.tracking : '');
    }

    // ---- 8. 自述信息 ----
    {
        const res = await call(route.handler, PREFIX + '/meta');
        const j = JSON.parse(res.text);
        check('GET /meta 返回 200', res.status === 200);
        check('/meta 报告姓名与路由', j.name === 'dsh-kujira' && j.route === PREFIX,
            j.name + ' @ ' + j.route);
        check('/meta 报告是否已配密钥（本次应为 false）', j.hasApiKey === false, 'hasApiKey=' + j.hasApiKey);
    }

    // ---- 9. 余额路由（没密钥时要优雅失败，不能 500）----
    {
        const res = await call(route.handler, PREFIX + '/balance');
        const j = JSON.parse(res.text);
        check('GET /balance 没密钥时不是 5xx', res.status === 200, 'status=' + res.status);
        check('/balance 明确报 no-key', j.ok === false && j.reason === 'no-key', JSON.stringify(j));
        check('/balance 附带可读的中文提示', typeof j.message === 'string' && j.message.length > 0);
    }

    // ---- 10. 天气路由（没传城市时要提示，不能 500）----
    {
        const res = await call(route.handler, PREFIX + '/weather?auto=0');
        const j = JSON.parse(res.text);
        check('GET /weather 关闭自动定位且未设城市时不是 5xx', res.status === 200, 'status=' + res.status);
        check('/weather 明确报 no-city', j.ok === false && j.reason === 'no-city', JSON.stringify(j));
    }

    // ---- 11. 素材与配置完整对账 ----
    {
        const { readdir, readFile } = await import('node:fs/promises');
        const files = (await readdir(join(ROOT, 'assets', 'anim'))).filter((f) => f.endsWith('.webm'));
        const config = JSON.parse(await readFile(join(ROOT, 'assets', 'pet.config.json'), 'utf8'));
        const onDisk = new Set(files.map((f) => f.slice(0, -5)));

        // 逐个真的走一遍路由，确保每个素材都取得到
        let okCount = 0;
        const failed = [];
        for (const anim of onDisk)
        {
            const res = await call(route.handler, PREFIX + '/anim/' + encodeURIComponent(anim) + '.webm');
            if (res.status === 200 && res.body.length > 0)
            {
                okCount++;
            }
            else
            {
                failed.push(anim + '(' + res.status + ')');
            }
        }
        check('全部 ' + onDisk.size + ' 个素材都能通过路由取到', failed.length === 0,
            failed.length ? failed.join(', ') : okCount + '/' + onDisk.size);

        const referenced = new Set();
        for (const list of Object.values(config.pools || {}))
        {
            (Array.isArray(list) ? list : []).forEach((n) => referenced.add(n));
        }
        referenced.add(config.startAnim);
        referenced.add(config.dragAnim);
        const missing = [...referenced].filter((n) => !onDisk.has(n));
        check('配置引用的动画都在磁盘上', missing.length === 0, missing.join(', ') || '全部命中');
    }

    // ---- 汇总 ----
    const failed = results.filter((r) => !r.ok);
    console.log('');
    if (failed.length)
    {
        console.error('[fail] ' + failed.length + '/' + results.length + ' 项未通过');
        process.exit(1);
    }
    console.log('[ok] ' + results.length + ' 项全部通过');
}

main().catch((error) =>
{
    console.error('[test-host] 意外错误：' + (error && error.stack ? error.stack : error));
    process.exit(1);
});
