import { createDesktopPresence } from "./desktop-presence.js";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { userInfo } from "node:os";
import { systemNickname } from "../shared/client/utilities.js";
import { resolveApiKey } from "./balance.js";
import { SHARED_ALLOW, STYLE_ALLOW } from "./resources.js";
import {
  resolveInside,
  sendFile,
  sendJson,
  sendText,
  requestScope,
  sendStyles,
} from "./http.js";
/**
 * @description Route plugin resources and read-only or transactional service operations.
 * @param {object} options Package paths and injected services.
 * @returns {Function} HTTP request handler.
 */
export function createRouteHandler({
  PACKAGE_ROOT,
  ROUTE_PREFIX,
  ctx,
  realtime,
  inventory,
  companionEvents,
  getAgents,
  scheduler,
  sessionAccess,
  activityReader,
  queryUsage,
  loadConfig,
  reloadConfig,
  watch,
  queryBalance,
  dailyUsage,
  queryExchange,
  queryWeather,
  setCity,
  getCare,
}) {
  const desktopPresence = createDesktopPresence();
  const ANIM_ROOT = join(PACKAGE_ROOT, "assets", "anim"),
    SHARED_ROOT = join(PACKAGE_ROOT, "lib", "shared");
  return async (req, res) => {
    const agents = getAgents();
    const url = new URL(req.url ?? "/", "http://localhost");
    const rest = decodeURIComponent(
      url.pathname.slice(ROUTE_PREFIX.length + 1),
    );

    try {
      if (rest === "desktop") {
        await desktopPresence.handle(req, res);
        return;
      }
      if (STYLE_ALLOW.has(rest)) {
        if (
          !(await sendFile(
            req,
            res,
            join(PACKAGE_ROOT, "lib", rest),
            ".css",
            "no-cache",
          ))
        )
          sendText(res, 404, "Style unavailable");
        return;
      }
      if (rest === "appearance.css") {
        await sendStyles(req, res, PACKAGE_ROOT);
        return;
      }
      if (rest === "exchange") {
        if (req.method !== "GET") {
          sendJson(res, 405, { ok: false });
          return;
        }
        sendJson(res, 200, await queryExchange());
        return;
      }
      if (rest === "realtime") {
        await realtime.ready;
        if (req.method === "GET") {
          sendJson(res, 200, realtime.status());
          return;
        }
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false });
          return;
        }
        if (
          req.headers["x-kujira-settings"] !== "1" ||
          (req.headers.origin &&
            new URL(req.headers.origin).host !== req.headers.host)
        ) {
          sendJson(res, 403, { ok: false });
          return;
        }
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 2048) {
            sendJson(res, 413, { ok: false });
            return;
          }
        }
        const input = JSON.parse(body || "{}");
        try {
          sendJson(res, 200, input.action === "refresh" ? await realtime.refresh(true) : await realtime.configure(input));
        } catch (error) {
          if (error.message !== "invalid-settings") throw error;
          sendJson(res, 400, {ok:false,message:"设置值无效，请检查输入"});
        }
        return;
      }
      if (rest === "inventory") {
        if (req.method === "GET") {
          sendJson(res, 200, {
            ...(await inventory.snapshot()),
            todayCoverage: dailyUsage?.snapshot(),
            activity: companionEvents.snapshot(),
            execution: {
              active: agents?.list
                ? agents
                    .list()
                    .filter(
                      (agent) =>
                        agent.status === "running" &&
                        !scheduler.paused(agent.session?.id || agent.id),
                    ).length
                : null,
            },
          });
          return;
        }
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false });
          return;
        }
        if (
          req.headers["x-kujira-inventory"] !== "1" ||
          (req.headers.origin &&
            new URL(req.headers.origin).host !== req.headers.host)
        ) {
          sendJson(res, 403, { ok: false });
          return;
        }
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 1024) {
            sendJson(res, 413, { ok: false });
            return;
          }
        }
        const value = JSON.parse(body || "{}");
        const result =
          value.action === "mode"
            ? await inventory.configure(value.free)
            : value.action === "rules"
              ? await inventory.configureRules(value.rules, value.revision)
              : await inventory.consume(value.kind, value.requestId);
        sendJson(res, 200, result);
        return;
      }
      if (rest === "scheduler") {
        await scheduler.ready;
        if (req.method === "GET") {
          sendJson(res, 200, scheduler.snapshot());
          return;
        }
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false });
          return;
        }
        if (
          req.headers["x-kujira-settings"] !== "1" ||
          (req.headers.origin &&
            new URL(req.headers.origin).host !== req.headers.host)
        ) {
          sendJson(res, 403, { ok: false });
          return;
        }
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 256) {
            sendJson(res, 413, { ok: false });
            return;
          }
        }
        const input = JSON.parse(body || "{}");
        sendJson(res, 200, await scheduler.configure(input.enabled));
        return;
      }
      if (rest === "activity") {
        const id = url.searchParams.get("sessionId");
        const scope = requestScope(req, res);
        if (id) await sessionAccess.prepare(id, { signal: scope.signal });
        if (scope.signal.aborted) {
          if (!res.destroyed)
            sendJson(res, 504, { ok: false, message: "读取超时，请重试" });
          return;
        }
        if (url.searchParams.get("detail")?.startsWith("child:"))
          await sessionAccess.prepare(url.searchParams.get("detail").slice(6), {
            signal: scope.signal,
          });
        if (url.searchParams.has("detail")) {
          const value = activityReader.detail(
            id,
            url.searchParams.get("detail"),
          );
          sendJson(res, value.ok ? 200 : 404, value);
          return;
        }
        if (url.searchParams.has("messagesBefore")) {
          const value = activityReader.messages(
            id,
            Number(url.searchParams.get("messagesBefore")),
          );
          sendJson(res, value.ok ? 200 : 400, value);
          return;
        }
        let value = id
          ? activityReader.read(id, { compact: true })
          : { ok: false, message: "缺少会话 ID" };
        if (value.ok) {
          const pausedChildren = value.activity.children.map((child) =>
            scheduler.paused(child.id),
          );
          const scheduling = scheduler.sessionState(id);
          const paused = scheduling.paused;
          const etag =
            '"' +
            value.epoch +
            "-" +
            value.revision +
            "-" +
            Number(paused) +
            "-" +
            pausedChildren.map(Number).join("") +
            "-" +
            Number(scheduling.pausing) +
            "-" +
            (scheduling.resumeAt || 0) +
            '"';
          res.setHeader?.("ETag", etag);
          if (req.headers?.["if-none-match"] === etag) {
            res.writeHead(304, { "Cache-Control": "no-store" });
            res.end();
            return;
          }
          value = {
            ...value,
            activity: {
              ...value.activity,
              scheduling,
              children: value.activity.children.map((child, i) =>
                pausedChildren[i] ? { ...child, stage: "paused" } : child,
              ),
            },
          };
          if (paused)
            value.activity = {
              ...value.activity,
              stage: "paused",
              phase: "waiting",
              label: "峰价暂停",
              attention: null,
            };
        }
        sendJson(res, id ? 200 : 400, value);
        return;
      }
      if (rest === "usage") {
        const sessionId = url.searchParams.get("sessionId");
        const scope = requestScope(req, res);
        if (sessionId)
          await sessionAccess.prepare(sessionId, {
            signal: scope.signal,
          });
        sendJson(
          res,
          sessionId ? 200 : 400,
          sessionId
            ? await queryUsage.tree(sessionId, { signal: scope.signal })
            : {
                ok: false,
                reason: "missing-session",
                message: "请选择一个会话。",
              },
        );
        return;
      }
      // ==== 1. 行为配置（实时读盘）====
      if (rest === "config.json") {
        try {
          const { raw } = await loadConfig();

          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(raw);
        } catch (error) {
          sendJson(res, 500, {
            ok: false,
            error:
              "读不到 assets/pet.config.json：" +
              String(error && error.message ? error.message : error),
          });
        }
        return;
      }

      // ==== 2. 纯逻辑模块（浏览器 dynamic import 用）====
      if (rest.startsWith("shared/")) {
        const file = rest.slice("shared/".length);

        // 白名单：只发明确允许的模块，不做目录遍历
        if (!SHARED_ALLOW.has(file)) {
          sendText(res, 404, "dsh-kujira: 不在白名单内的模块：" + file);
          return;
        }

        const full = resolveInside(SHARED_ROOT, file);
        if (full === undefined) {
          sendText(res, 400, "dsh-kujira: 非法路径");
          return;
        }
        if (!(await sendFile(req, res, full, ".js", "no-cache"))) {
          sendText(res, 404, "dsh-kujira: 找不到模块 " + file);
        }
        return;
      }

      // ==== 3. 动画素材 ====
      if (rest.startsWith("anim/")) {
        const fileName = rest.slice("anim/".length);
        const full = resolveInside(ANIM_ROOT, fileName);

        if (full === undefined) {
          sendText(res, 400, "dsh-kujira: 非法路径");
          return;
        }
        if (
          !(await sendFile(
            req,
            res,
            full,
            extname(full) || ".webm",
            "public, max-age=86400",
          ))
        ) {
          sendText(res, 404, "dsh-kujira: 找不到动画 " + fileName);
        }
        return;
      }

      // ==== 4. 会话状态快照 ====
      if (rest === "state") {
        if (req.method !== "GET") {
          sendJson(res, 405, { ok: false, error: "method not allowed" });
          return;
        }
        // 顺手刷新配置：改了 config.json 不用重装也不用重启
        await reloadConfig();

        const snap = watch.snapshot();
        sendJson(
          res,
          200,
          Object.assign({ ok: true, tracking: watch.size() }, snap),
        );
        return;
      }

      // ==== 5. 余额 ====
      if (rest === "balance") {
        if (req.method !== "GET") {
          sendJson(res, 405, { ok: false, error: "method not allowed" });
          return;
        }
        const force = url.searchParams.get("force") === "1";
        // 失败也回 200：错误是业务结果，不是网络故障，
        // 让浏览器能统一处理（避免 fetch 抛异常路径）
        dailyUsage?.start();
        sendJson(res, 200, await queryBalance(force));
        return;
      }

      // ==== 6. 天气 ====
      if (rest === "weather") {
        if (req.method !== "GET") {
          sendJson(res, 405, { ok: false, error: "method not allowed" });
          return;
        }
        // 城市由浏览器传上来（存在 localStorage 里）
        setCity(url.searchParams.get("city") || "");
        const force = url.searchParams.get("force") === "1";
        sendJson(
          res,
          200,
          await queryWeather(force, {
            auto: url.searchParams.get("auto") !== "0",
            region: url.searchParams.get("region"),
            locale: url.searchParams.get("locale") || "zh-CN",
          }),
        );
        return;
      }

      // ==== 7. 自述信息 ====
      if (rest === "meta") {
        const key = await resolveApiKey(ctx);

        let version = "0.0.0";
        try {
          const pkg = JSON.parse(
            await readFile(join(PACKAGE_ROOT, "package.json"), "utf8"),
          );
          version = pkg.version || version;
        } catch (error) {
          // 忽略，用默认版本号
        }

        sendJson(res, 200, {
          ok: true,
          name: "dsh-kujira",
          version,
          route: ROUTE_PREFIX,
          hasApiKey: Boolean(key),
          systemName: systemNickname(() => userInfo().username),
          sessionsTracked: watch.size(),
          care: getCare(),
        });
        return;
      }

      // ==== 其他 ====
      sendText(res, 404, "dsh-kujira: 未知路径 " + rest);
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 500, {
          ok: false,
          error: String(error && error.message ? error.message : error),
        });
      } else {
        res.destroy();
      }
    }
  };
}
