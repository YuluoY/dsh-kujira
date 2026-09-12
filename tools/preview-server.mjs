/**
 * ============================================================================
 * tools/preview-server.mjs —— 不启动 DSH 也能看效果的本地预览服务
 * ============================================================================
 *
 * 【它解决什么问题】
 *   在 DSH 里调插件，每次都要：改代码 → 重启 dsh web → 刷新页面。
 *   但桌宠大部分调整是"视觉/手感"层面的，循环太慢。
 *   本脚本起一个极小的 HTTP 服务，把桌宠跑在普通浏览器标签页里，
 *   改完 lib/client.js 直接 F5 就能看，不用碰 DSH。
 *
 * 【关键设计：复用真实宿主代码】
 *   所有 `/dsh-kujira/*` 路由，都直接调用 lib/index.js 里真实的 apply()
 *   抠出来的 handler —— 预览环境走过的路径和 DSH 里完全一致，
 *   不会出现"预览好好的、装进 DSH 就 404"。
 *
 * 【模拟会话状态】
 *   真实的 `session/event` 来自 DSH。这里用一个假 ctx 把那个事件处理器
 *   截获下来，再通过 `POST /__preview/emit` 手动触发 ——
 *   于是不用跑 DSH 也能看到"工作中 / 等你确认 / 完成 / 出错了"的联动效果。
 *
 * 【余额】
 *   假 ctx 提供一个 credentials 实现：先看环境变量 DEEPSEEK_API_KEY，
 *   再读 ~/.dsh/.credentials.yaml。**密钥只在服务端用，不会发给浏览器**
 *   —— 和 DSH 里跑的行为一致。
 *
 * 【用法】
 *   npm run preview        # 等价于 node tools/preview-server.mjs
 *   PREVIEW_PORT=8899 npm run preview
 * ============================================================================
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { apply } from '../lib/index.js';
import {createActivityReader} from '../lib/host/activity.js';
import { activityPreview } from './fixtures/activity-preview.mjs';
import {rateAt} from '../lib/shared/billing.js';
import { previewUsage } from './fixtures/usage-preview.mjs';
let usagePreviewMode='offpeak';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PREVIEW_PORT || 8792);

// ============================================================================
// 从 DSH 凭据文件里取 DeepSeek Key（只在服务端使用，绝不外发）
// ============================================================================
function loadApiKey()
{
    // 1) 环境变量优先
    if (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.trim())
    {
        return { value: process.env.DEEPSEEK_API_KEY.trim(), source: 'env' };
    }

    // 2) 退回 DSH 的凭据文件。只做最简单的行扫描 —— 不引入 YAML 依赖。
    //    注意键是**缩进**在 refs: 下面的，正则必须允许前导空白，
    //    否则会像第一版那样扫不到。
    try
    {
        const file = join(homedir(), '.dsh', '.credentials.yaml');
        const text = readFileSync(file, 'utf8');
        const m = text.match(/^[ \t]*DEEPSEEK_API_KEY:[ \t]*(\S+)[ \t]*$/m);
        if (m && m[1])
        {
            // 去掉可能的引号
            const v = m[1].replace(/^["']|["']$/g, '');
            return { value: v, source: 'dsh-file' };
        }
    }
    catch (error)
    {
        // 读不到就算了
    }

    return null;
}

const apiKey = loadApiKey();

// ============================================================================
// 用一个假 ctx 抠出真实路由，并截获 session/event 处理器
// ============================================================================
const routes = [];
const sessionHandlers = [];
const agentHandlers = [];
let supplyDemoSerial=0, supplyClock=0, previewRunning=false;
const previewEvents = [];
const previewChildren=new Map();
const previewSession = { header: { id: 'preview-session' }, inheritedEventCount: 0, snapshotEvents: () => previewEvents.slice() };

const ctx = {
    inject(deps, callback) { callback(this); },
    agents: {list:()=>previewRunning?[{id:"preview-session",status:"running"}]:[]},
    sessions: { get(id) { return id === 'preview-session' ? previewSession : previewChildren.get(id); } },
    effect(fn)
    {
        return fn();
    },
    on(event, handler)
    {
        if (event === 'agent/status') agentHandlers.push(handler);
        if (event === 'session/event')
        {
            sessionHandlers.push(handler);
        }
        // cordis 的 ctx.on 返回注销函数
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
        // 与 DSH 的 CredentialProvider 同形：resolve(ref) → { value, source }
        async resolve()
        {
            return apiKey || undefined;
        },
        async describe()
        {
            return { configured: Boolean(apiKey), writable: false };
        }
    }
};

apply(ctx, { size: 260, scheduler:{preview:true,now:()=>Date.parse(usagePreviewMode==='peak'?'2026-09-11T10:30:00+08:00':'2026-09-11T20:30:00+08:00')}, inventory: { now:()=>supplyClock || Date.now(), directory: join(homedir(), '.dsh', 'dsh-kujira-preview', String(PORT)) } });

// ============================================================================
// 模拟会话事件
// ============================================================================

function emit(kind, sessionId)
{
    previewRunning=!["idle","abort","success","error"].includes(kind);
    const fixture=activityPreview(kind);
    previewEvents.splice(0,previewEvents.length,...fixture.events);
    previewChildren.clear();
    for(const child of fixture.children)previewChildren.set(child.id,{header:{id:child.id,parentSession:'preview-session',origin:'subagent'},inheritedEventCount:0,snapshotEvents:()=>child.events});
    return {ok:true,kind,sessionId:'preview-session',events:previewEvents.length};
}

emit('working');

// ============================================================================
// 静态文件
// ============================================================================
const STATIC = {
    '/': { file: join(ROOT, 'tools', 'preview.html'), type: 'text/html; charset=utf-8' },
    '/preview.html': { file: join(ROOT, 'tools', 'preview.html'), type: 'text/html; charset=utf-8' },
    '/client.js': { file: join(ROOT, 'lib', 'client.js'), type: 'text/javascript; charset=utf-8' }
};

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webm': 'video/webm',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
};

/** 读请求体（很小，够用）。 */
function readBody(req)
{
    return new Promise((resolve) =>
    {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', () => resolve(''));
    });
}

const previewActivityReader=createActivityReader(()=>ctx.sessions);
const server = createServer(async (req, res) =>
{
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    if(pathname==='/__preview/rewards' && req.method==='POST') {
        previewRunning=true;
        const requested=url.searchParams.get('mode') || usagePreviewMode;
        let now=Date.now();
        for(let i=0;i<336 && rateAt(now)!==requested;i++) now+=1800000;
        supplyClock=now;
        const id='preview-supply-'+now+'-'+(++supplyDemoSerial);
        const events=[{type:'request/header',time:now,data:{header:{config:{provider:'deepseek-official',model:'deepseek-flash'}}}},
          {type:'assistant/message',time:now,seq:1,data:{turn:1,step:1,usage:{inputTokens:0,outputTokens:125000}}}];
        const session={id,header:{id},snapshotEvents:()=>events,inheritedEventCount:0};
        for(const handler of sessionHandlers)handler(session,events[1]);
        for(const handler of agentHandlers)handler({agent:{id,session:{id,header:{id},snapshotEvents:()=>[]}},status:'running'});
        res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,preview:true}));return;
    }
    const gallery = new URL(req.headers.referer || '/', 'http://localhost').searchParams.has('gallery');
    if (pathname === '/dsh-kujira/balance' && gallery) {
        const account = {currency:'¥',rawCurrency:'CNY',total:110,granted:10,toppedUp:100};
        res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'});
        res.end(JSON.stringify({ok:true,available:true,...account,balances:[account],fetchedAt:Date.now()}));return;
    }
    if(pathname==='/dsh-kujira/activity') {
        const value=previewActivityReader.read(url.searchParams.get('sessionId'));
        res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({...value,preview:true}));return;
    }
    // Preview-only usage fixtures never pass through reward settlement.
    if(pathname==='/dsh-kujira/usage' && url.searchParams.get('sessionId')==='preview-session') {
        res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(previewUsage(usagePreviewMode)));return;
    }
    if(pathname==='/__preview/usage' && req.method==='POST') {
        const mode=url.searchParams.get('mode');
        if(!['peak','offpeak','empty'].includes(mode)){res.writeHead(400);res.end();return;}
        usagePreviewMode=mode;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,mode}));return;
    }
    // ---- 0. 预览专用接口 ----
    if (pathname.startsWith('/__preview/'))
    {
        if (pathname === '/__preview/emit')
        {
            let kind = url.searchParams.get('kind') || '';
            let sid = url.searchParams.get('session') || '';
            if (req.method === 'POST')
            {
                try
                {
                    const body = JSON.parse(await readBody(req));
                    kind = body.kind || kind;
                    sid = body.session || sid;
                }
                catch (error)
                {
                    // 用 query 里的
                }
            }
            const out = emit(kind, sid);
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify(out));
            return;
        }

        if (pathname === '/__preview/info')
        {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({
                ok: true,
                hasApiKey: Boolean(apiKey),
                apiKeySource: apiKey ? apiKey.source : null,
                sessionHandlers: sessionHandlers.length,
                pluginRoutes: routes.map((r) => r.kind + ' ' + r.path)
            }));
            return;
        }
    }

    // ---- 1. 真实插件路由 ----
    for (const route of routes)
    {
        const isPrefix = route.kind === 'prefix' &&
            (pathname === route.path || pathname.startsWith(route.path + '/'));
        const isExact = route.kind === 'exact' && pathname === route.path;

        if (isPrefix || isExact)
        {
            try
            {
                await route.handler(req, res);
            }
            catch (error)
            {
                if (!res.headersSent)
                {
                    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
                    res.end('preview: ' + error.message);
                }
                else
                {
                    res.destroy();
                }
            }
            return;
        }
    }

    // ---- 2. 内置静态文件 ----
    if (STATIC[pathname])
    {
        const entry = STATIC[pathname];
        if (!existsSync(entry.file))
        {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('preview: 缺少 ' + entry.file);
            return;
        }
        const info = await stat(entry.file);
        res.writeHead(200, {
            'content-type': entry.type,
            'content-length': String(info.size),
            'cache-control': 'no-store'
        });
        if (req.method === 'HEAD')
        {
            res.end();
            return;
        }
        createReadStream(entry.file).pipe(res);
        return;
    }

    // ---- 3. 项目目录下的其他文件 ----
    {
        const rel = pathname.replace(/^\/+/, '');
        const file = join(ROOT, rel);
        if (file.startsWith(ROOT) && existsSync(file) && (await stat(file)).isFile())
        {
            const info = await stat(file);
            res.writeHead(200, {
                'content-type': MIME[extname(file)] || 'application/octet-stream',
                'content-length': String(info.size),
                'cache-control': 'no-store'
            });
            createReadStream(file).pipe(res);
            return;
        }
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('preview: 404 ' + pathname);
});

server.listen(PORT, '127.0.0.1', () =>
{
    console.log('');
    console.log('  dsh-kujira 预览已启动');
    console.log('');
    console.log('    →  http://127.0.0.1:' + PORT + '/');
    console.log('');
    console.log('  路由由 lib/index.js 的真实 handler 提供：');
    for (const r of routes)
    {
        console.log('    · ' + r.kind.padEnd(7) + ' ' + r.path);
    }
    console.log('');
    console.log('  余额：' + (apiKey
        ? '可用（密钥来源 ' + apiKey.source + '，只在服务端使用）'
        : '不可用 —— 没找到 DEEPSEEK_API_KEY'));
    console.log('  会话事件处理器：已截获 ' + sessionHandlers.length + ' 个，可用页面上的按钮模拟状态');
    console.log('');
    console.log('  改 lib/client.js 或 assets/pet.config.json 后，浏览器 F5 即可。Ctrl+C 退出。');
    console.log('');
});

process.on('SIGINT', () =>
{
    server.close(() => process.exit(0));
});
