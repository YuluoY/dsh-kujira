import {createCompanionEvents} from './host/companion-events.js';
import {homedir} from 'node:os';
import {createSessionAccess} from './host/session-access.js';
import {createPeakScheduler} from './host/scheduler.js';
import {createActivityReader} from './host/activity.js';
/**
 * ============================================================================
 * dsh-kujira · 宿主半侧（host half）
 * ============================================================================
 *
 * 【这个文件干什么】
 *   跑在 DSH 的 Node 服务端。三件事：
 *     1. 订阅 DSH 会话事件，聚合出"宠物现在该显示什么状态"
 *     2. 在 Web 服务器上挂 `/dsh-kujira/*` 路由，把素材、状态、余额、天气
 *        发给浏览器
 *     3. 查余额（**密钥只在宿主侧使用，绝不进浏览器**）
 *
 * 【为什么余额不能让浏览器自己查】
 *   · 要用 API Key —— 发给浏览器等于泄露
 *   · 浏览器直连外部 API 会撞 CORS，也破坏了"只访问本机"的信任预期
 *   所以：宿主请求 → 归一化 → 只把结果给浏览器。
 *
 * 【路由表】
 *   GET /dsh-kujira/config.json        行为配置（实时读盘，改完刷新即生效）
 *   GET /dsh-kujira/shared/<file>.js   纯逻辑模块（浏览器 dynamic import 用）
 *   GET /dsh-kujira/anim/<名字>.webm    透明动画素材
 *   GET /dsh-kujira/state              当前会话状态快照
 *   GET /dsh-kujira/balance[?force=1]  余额（含档位）
 *   GET /dsh-kujira/weather?city=&force=1  天气
 *   GET /dsh-kujira/meta               插件自述（版本、是否已配密钥等）
 *
 * 【一个设计决定：设置项存在浏览器 localStorage，不占 settings 服务】
 *   城市名这类偏好由浏览器侧持有，调 /weather 时作为 query 传上来。
 *   好处是宿主不需要管理配置生命周期，也不用引入 settings 服务依赖。
 *
 * ============================================================================
 * @module dsh-kujira
 */

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSessionWatch } from './host/session-watch.js';
import { createBalanceClient, resolveApiKey } from './host/balance.js';
import { createWeatherClient } from './host/weather.js';
import {createSettlementObserver} from './host/settlement-observer.js';
import { createInventory } from './host/inventory.js';
import { createUsageReader } from './host/usage.js';
import { createRealtime } from './host/realtime.js';
import { PRICING } from './shared/session-cost.js';

/**
 * Cordis 插件名。必须与 package.json 的 name 一致。
 */
export const name = 'dsh-kujira';

/**
 * 需要宿主注入的服务。
 * webServer   —— 注册 HTTP 路由
 * credentials —— 取 DeepSeek API Key（余额功能用）
 */
export const inject = ['webServer', 'credentials'];

/**
 * 本包根目录。
 */
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * 路由前缀。改名时这里和 lib/client.js 的 ASSET_BASE 要一起改。
 */
const ROUTE_PREFIX = '/dsh-kujira';

/**
 * 各类资源路径。
 */
const CONFIG_FILE = join(PACKAGE_ROOT, 'assets', 'pet.config.json');
const ANIM_ROOT = join(PACKAGE_ROOT, 'assets', 'anim');
const SHARED_ROOT = join(PACKAGE_ROOT, 'lib', 'shared');

/**
 * 允许从 /shared/ 下暴露的模块白名单（防止把任意文件当模块发出去）。
 *
 * 往 lib/shared/ 加新文件时要记得同步这里 —— 漏掉的话浏览器会拿到 404，
 * 但页面不会报错，只是那一块功能静默退化成默认值，很难查。
 */
import {SHARED_ALLOW,STYLE_FILES,STYLE_ALLOW} from './host/resources.js';

/**
 * 静态资源的 MIME。
 */
const MIME = {
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webm': 'video/webm'
};

/**
 * 把请求里的相对路径解析成绝对路径，并做防目录穿越校验。
 *
 * @returns 合法则返回绝对路径；非法返回 undefined
 */
function resolveInside(root, relative)
{
    const cleaned = normalize(relative).replace(/^([/\\])+/, '');
    const full = resolve(root, cleaned);

    if (full !== root && !full.startsWith(root + sep))
    {
        return undefined;
    }
    return full;
}

/**
 * 发 JSON（一律不缓存，保证改完配置刷新即生效）。
 */
function sendJson(res, status, payload)
{
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(Buffer.byteLength(body)),
        'cache-control': 'no-store'
    });
    res.end(body);
}

/**
 * 发纯文本。
 */
function sendText(res, status, text)
{
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(text);
}

/**
 * 流式发一个文件。
 * 返回 true 表示已接管响应（文件存在）；false 表示文件不存在，调用方自己回 404。
 */
async function sendFile(req, res, file, ext, cacheControl)
{
    let info;
    try
    {
        info = await stat(file);
    }
    catch (error)
    {
        return false;
    }

    res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'content-length': String(info.size),
        'cache-control': cacheControl
    });

    if (req.method === 'HEAD')
    {
        res.end();
        return true;
    }

    // 流式发送：此时 200 头已经写出去了，出错只能断开连接，
    // 再回错误响应会触发 "headers already sent"。
    const stream = createReadStream(file);
    stream.on('error', () =>
    {
        try
        {
            res.destroy();
        }
        catch (error)
        {
            // 已经断了，无所谓
        }
    });
    stream.pipe(res);
    return true;
}

/**
 * 宿主插件主体。
 *
 * @param ctx 插件上下文
 * @param config 本行配置（来自 cordis.patch.yml）
 */
export function apply(ctx, config)
{
    // ------------------------------------------------------------------
    // 1. 配置：TTL 覆盖 + 关怀参数（每次读盘，改完刷新即生效）
    // ------------------------------------------------------------------
    let ttlOverride = {};
    let careConfig = {};
    let billingConfig = null;
    let growthEnabled = true;
    const realtime = createRealtime({ getKey: () => resolveApiKey(ctx), disabled: config?.realtime?.enabled === false, cacheDir: config?.realtime?.cacheDir });
    ctx.effect(() => { let disposed = false; realtime.ready.then(() => { if (!disposed) realtime.refresh().catch(() => {}); }); const timer = setInterval(() => realtime.refresh().catch(() => {}), 3600000); timer.unref?.(); return () => { disposed = true; clearInterval(timer); }; });
    let sessions = null;
    if (typeof ctx.inject === 'function')
    {
        ctx.inject(['sessions'], (scope) => {
            sessions = scope.sessions;
            scope.effect(() => () => { sessions = null; });
        });
    }
    let agents = null;
    const companionEvents = createCompanionEvents();
    ctx.effect(() => ctx.on('agent/status', payload => companionEvents.started(payload)));
    const scheduler=createPeakScheduler({getAgents:()=>agents?.list?.() || [],directory:config?.scheduler?.directory || config?.inventory?.directory || join(homedir(),'.dsh','dsh-kujira'),getConfig:()=>billingConfig || realtime.pricing(),preview:!!config?.scheduler?.preview,now:config?.scheduler?.now || Date.now});
    ctx.inject?.(['agents'],scope=>{agents=scope.agents;scheduler.setAvailable(!!agents);scope.effect(()=>()=>{agents=null;scheduler.setAvailable(false);});});
    ctx.effect(()=>ctx.on('agent/pre-step',(payload,next)=>scheduler.gate(payload,next),{prepend:true}));
    ctx.effect(()=>ctx.on('agent/request',(payload,next)=>scheduler.gate(payload,next),{prepend:true}));
    ctx.effect(()=>()=>scheduler.dispose());
    let sessionController = null;
    const sessionAccess = createSessionAccess(() => sessions, () => sessionController);
    ctx.inject?.(['sessionController'], scope => {
        sessionController = scope.sessionController;
        scope.effect(() => () => {sessionController = null; sessionAccess.clear();});
    });
    ctx.effect(() => () => sessionAccess.clear());
    const activityReader = createActivityReader(() => sessionAccess);
    ctx.effect(() => ctx.on('session/event', (session,event) => activityReader.observe(session,event)));
    ctx.effect(() => ctx.on('subagent/end', info => activityReader.settled(info)));
    const queryUsage = createUsageReader(() => sessionAccess, () => billingConfig || realtime.pricing());

    async function reloadConfig()
    {
        try
        {
            const parsed = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
            growthEnabled = parsed.growth?.enabled !== false;
            ttlOverride = (parsed && parsed.state && parsed.state.ttl) || {};
            careConfig = (parsed && parsed.care) || {};
            billingConfig = parsed.billing ? Object.assign({}, PRICING, parsed.billing) : null;
        }
        catch (error)
        {
            // 配置坏了就用默认值，绝不因此阻塞插件
            ttlOverride = {};
            careConfig = {};
        }
    }

    // 启动读一次
    reloadConfig().catch(() => {});

    /**
     * 同步取 TTL 覆盖（事件回调里用）。
     */
    const getTtl = () => ttlOverride;

    // ------------------------------------------------------------------
    // 2. 会话观察器 / 余额客户端 / 天气客户端
    // ------------------------------------------------------------------
    const watch = createSessionWatch(ctx, getTtl);
    const queryBalance = createBalanceClient(ctx);
    const inventory = createInventory({directory:config?.inventory?.directory,now:config?.inventory?.now || Date.now,getConfig:()=>billingConfig || realtime.pricing(),enabled:()=>growthEnabled,isBusy:()=>['thinking','working','result'].includes(watch.snapshot().state)});
    const settlementObserver=createSettlementObserver(session=>inventory.observe(session),{onError:error=>console.warn('[dsh-kujira] Inventory persistence failed:',error.code || error.message)});
    ctx.effect(()=>()=>settlementObserver.dispose());
    ctx.effect(()=>ctx.on('session/event',(session,event)=>{
        if(['assistant/message','assistant/attempt','turn/end'].includes(event?.type)) {
            const live=typeof session?.snapshotEvents==='function'?session:sessions?.get(session?.header?.id || session?.id);
            if(live)settlementObserver.enqueue(live);
        }
    }));

    /**
     * 天气的城市名由浏览器通过 query 传上来，这里只记住最后一次，用于日志。
     */
    let lastCity = '';
    const queryWeather = createWeatherClient(() => lastCity);

    // ------------------------------------------------------------------
    // 3. 路由
    // ------------------------------------------------------------------
    ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,

        handler: async (req, res) =>
        {
            const url = new URL(req.url ?? '/', 'http://localhost');
            const rest = decodeURIComponent(url.pathname.slice(ROUTE_PREFIX.length + 1));

            try
            {
                if (STYLE_ALLOW.has(rest)) {
 await sendFile(req,res,join(PACKAGE_ROOT,'lib',rest),'.css','no-store');return;
 }
 if (rest === 'appearance.css')
                {
                    const styles = await Promise.all(STYLE_FILES.map(file => readFile(join(PACKAGE_ROOT,'lib','styles',file),'utf8')));
 res.statusCode=200;res.setHeader('Content-Type','text/css; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(styles.join('\n'));
                    return;
                }
                if (rest === 'realtime') {
                    await realtime.ready;
                    if (req.method === 'GET') { sendJson(res, 200, realtime.status()); return; }
                    if (req.method !== 'POST') { sendJson(res, 405, { ok:false }); return; }
                    if (req.headers['x-kujira-settings'] !== '1' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) { sendJson(res, 403, { ok:false }); return; }
                    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 2048) { sendJson(res, 413, { ok:false }); return; } }
                    const input = JSON.parse(body || '{}');
                    sendJson(res, 200, input.action === 'refresh' ? await realtime.refresh(true) : await realtime.configure(input)); return;
                }
                if (rest === 'inventory') {
                    if (req.method === 'GET') { sendJson(res, 200, {...await inventory.snapshot(), activity:companionEvents.snapshot(), execution:{active:agents?.list ? agents.list().filter(agent=>agent.status==='running' && !scheduler.paused(agent.session?.id || agent.id)).length : null}}); return; }
                    if (req.method !== 'POST') { sendJson(res,405,{ok:false}); return; }
                    if (req.headers['x-kujira-inventory'] !== '1' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) {sendJson(res,403,{ok:false});return;}
                    let body='';for await (const chunk of req) {body+=chunk;if(body.length>1024){sendJson(res,413,{ok:false});return;}}
                    const value=JSON.parse(body || '{}');
                    const result=value.action==='mode'?await inventory.configure(value.free):await inventory.consume(value.kind,value.requestId);
                    sendJson(res,200,result);return;
                }
                if(rest==='scheduler') {
                    await scheduler.ready;
                    if(req.method==='GET'){sendJson(res,200,scheduler.snapshot());return;}
                    if(req.method!=='POST'){sendJson(res,405,{ok:false});return;}
                    if(req.headers['x-kujira-settings']!=='1' || (req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)){sendJson(res,403,{ok:false});return;}
                    let body='';for await(const chunk of req){body+=chunk;if(body.length>256){sendJson(res,413,{ok:false});return;}}
                    const input=JSON.parse(body || '{}');
                    sendJson(res,200,await scheduler.configure(input.enabled));return;
                }
                if (rest === 'activity') {
                    const id=url.searchParams.get('sessionId');
                    if (id) await sessionAccess.prepare(id);
                    let value=id?activityReader.read(id):{ok:false,message:'缺少会话 ID'};
                    if(value.ok) {
                        const pausedChildren=value.activity.children.map(child=>scheduler.paused(child.id));
                        const paused=scheduler.paused(id);
                        const etag='"'+value.epoch+'-'+value.revision+'-'+Number(paused)+'-'+pausedChildren.map(Number).join('')+'"';
                        res.setHeader?.('ETag',etag);
                        if(req.headers?.['if-none-match']===etag){res.writeHead(304,{'Cache-Control':'no-store'});res.end();return;}
                        value={...value,activity:{...value.activity,children:value.activity.children.map((child,i)=>pausedChildren[i]?{...child,stage:'paused'}:child)}};
                        if(paused)value.activity={...value.activity,stage:'paused',phase:'waiting',label:'峰价暂停',attention:null};
                    }
                    sendJson(res,id?200:400,value);
                    return;
                }
                if (rest === 'usage')
                {
                    const sessionId = url.searchParams.get('sessionId');
                    if (sessionId) await sessionAccess.prepare(sessionId);
                    sendJson(res, sessionId ? 200 : 400, sessionId ? queryUsage(sessionId)
                        : { ok: false, reason: 'missing-session', message: '请选择一个会话。' });
                    return;
                }
                // ==== 1. 行为配置（实时读盘）====
                if (rest === 'config.json')
                {
                    try
                    {
                        const raw = await readFile(CONFIG_FILE, 'utf8');
                        // 顺手刷新宿主侧缓存
                        const parsed = JSON.parse(raw);
                        ttlOverride = (parsed && parsed.state && parsed.state.ttl) || {};
                        careConfig = (parsed && parsed.care) || {};

                        res.writeHead(200, {
                            'content-type': 'application/json; charset=utf-8',
                            'cache-control': 'no-store'
                        });
                        res.end(raw);
                    }
                    catch (error)
                    {
                        sendJson(res, 500, {
                            ok: false,
                            error: '读不到 assets/pet.config.json：' +
                                String(error && error.message ? error.message : error)
                        });
                    }
                    return;
                }

                // ==== 2. 纯逻辑模块（浏览器 dynamic import 用）====
                if (rest.startsWith('shared/'))
                {
                    const file = rest.slice('shared/'.length);

                    // 白名单：只发明确允许的模块，不做目录遍历
                    if (!SHARED_ALLOW.has(file))
                    {
                        sendText(res, 404, 'dsh-kujira: 不在白名单内的模块：' + file);
                        return;
                    }

                    const full = resolveInside(SHARED_ROOT, file);
                    if (full === undefined)
                    {
                        sendText(res, 400, 'dsh-kujira: 非法路径');
                        return;
                    }
                    if (!await sendFile(req, res, full, '.js', 'no-store'))
                    {
                        sendText(res, 404, 'dsh-kujira: 找不到模块 ' + file);
                    }
                    return;
                }

                // ==== 3. 动画素材 ====
                if (rest.startsWith('anim/'))
                {
                    const fileName = rest.slice('anim/'.length);
                    const full = resolveInside(ANIM_ROOT, fileName);

                    if (full === undefined)
                    {
                        sendText(res, 400, 'dsh-kujira: 非法路径');
                        return;
                    }
                    if (!await sendFile(req, res, full, extname(full) || '.webm', 'public, max-age=86400'))
                    {
                        sendText(res, 404, 'dsh-kujira: 找不到动画 ' + fileName);
                    }
                    return;
                }

                // ==== 4. 会话状态快照 ====
                if (rest === 'state')
                {
                    if (req.method !== 'GET')
                    {
                        sendJson(res, 405, { ok: false, error: 'method not allowed' });
                        return;
                    }
                    // 顺手刷新配置：改了 config.json 不用重装也不用重启
                    await reloadConfig();

                    const snap = watch.snapshot();
                    sendJson(res, 200, Object.assign({ ok: true, tracking: watch.size() }, snap));
                    return;
                }

                // ==== 5. 余额 ====
                if (rest === 'balance')
                {
                    if (req.method !== 'GET')
                    {
                        sendJson(res, 405, { ok: false, error: 'method not allowed' });
                        return;
                    }
                    const force = url.searchParams.get('force') === '1';
                    // 失败也回 200：错误是业务结果，不是网络故障，
                    // 让浏览器能统一处理（避免 fetch 抛异常路径）
                    sendJson(res, 200, await queryBalance(force));
                    return;
                }

                // ==== 6. 天气 ====
                if (rest === 'weather')
                {
                    if (req.method !== 'GET')
                    {
                        sendJson(res, 405, { ok: false, error: 'method not allowed' });
                        return;
                    }
                    // 城市由浏览器传上来（存在 localStorage 里）
                    lastCity = url.searchParams.get('city') || '';
                    const force = url.searchParams.get('force') === '1';
                    sendJson(res, 200, await queryWeather(force, { auto: url.searchParams.get('auto') !== '0', region:url.searchParams.get('region'), locale:url.searchParams.get('locale') || 'zh-CN' }));
                    return;
                }

                // ==== 7. 自述信息 ====
                if (rest === 'meta')
                {
                    const key = await resolveApiKey(ctx);

                    let version = '0.0.0';
                    try
                    {
                        const pkg = JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
                        version = pkg.version || version;
                    }
                    catch (error)
                    {
                        // 忽略，用默认版本号
                    }

                    sendJson(res, 200, {
                        ok: true,
                        name: 'dsh-kujira',
                        version,
                        route: ROUTE_PREFIX,
                        hasApiKey: Boolean(key),
                        sessionsTracked: watch.size(),
                        care: careConfig
                    });
                    return;
                }

                // ==== 其他 ====
                sendText(res, 404, 'dsh-kujira: 未知路径 ' + rest);
            }
            catch (error)
            {
                if (!res.headersSent)
                {
                    sendJson(res, 500, {
                        ok: false,
                        error: String(error && error.message ? error.message : error)
                    });
                }
                else
                {
                    res.destroy();
                }
            }
        }
    }), 'dsh-kujira: /dsh-kujira/* 资源与数据路由');

    console.log('[dsh-kujira] 已挂载 ' + ROUTE_PREFIX + '/');
    console.log('[dsh-kujira]   /config.json  /anim/*  /shared/*  /state  /balance  /weather  /meta');
}
