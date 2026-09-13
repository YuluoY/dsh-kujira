import { createExchangeClient } from "./host/exchange.js";
import { createRouteHandler } from "./host/routes.js";
import { createCompanionEvents } from "./host/companion-events.js";
import { homedir } from "node:os";
import { createSessionAccess } from "./host/session-access.js";
import { createPeakScheduler } from "./host/scheduler.js";
import { createActivityReader } from "./host/activity.js";
import { readFile, stat } from "node:fs/promises";

import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createSessionWatch } from "./host/session-watch.js";
import { createBalanceClient, resolveApiKey } from "./host/balance.js";
import { createWeatherClient } from "./host/weather.js";
import { createSettlementObserver } from "./host/settlement-observer.js";
import { createInventory } from "./host/inventory.js";
import { createUsageReader } from "./host/usage.js";
import { createRealtime } from "./host/realtime.js";
import { PRICING } from "./shared/session-cost.js";

// Cordis 插件名。必须与 package.json 的 name 一致。
export const name = "dsh-kujira";

/**
 * 需要宿主注入的服务。
 * webServer   —— 注册 HTTP 路由
 * credentials —— 取 DeepSeek API Key（余额功能用）
 */
export const inject = ["webServer", "credentials"];

// 本包根目录。
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

// 路由前缀。改名时这里和 lib/client.js 的 ASSET_BASE 要一起改。
const ROUTE_PREFIX = "/dsh-kujira";

// 各类资源路径。
const CONFIG_FILE = join(PACKAGE_ROOT, "assets", "pet.config.json");

/**
 * 允许从 /shared/ 下暴露的模块白名单（防止把任意文件当模块发出去）。
 *
 * 往 lib/shared/ 加新文件时要记得同步这里 —— 漏掉的话浏览器会拿到 404，
 * 但页面不会报错，只是那一块功能静默退化成默认值，很难查。
 */

/**
 * 宿主插件主体。
 *
 * @param ctx 插件上下文
 * @param config 本行配置（来自 cordis.patch.yml）
 */
export function apply(ctx, config) {
  // ------------------------------------------------------------------
  // 1. 配置：TTL 覆盖 + 关怀参数（每次读盘，改完刷新即生效）
  // ------------------------------------------------------------------
  let ttlOverride = {};
  let careConfig = {};
  let billingConfig = null;
  let growthEnabled = true;
  const realtime = createRealtime({
    getKey: () => resolveApiKey(ctx),
    disabled: config?.realtime?.enabled === false,
    cacheDir: config?.realtime?.cacheDir,
  });
  ctx.effect(() => {
    let disposed = false;
    realtime.ready.then(() => {
      if (!disposed) realtime.refresh().catch(() => {});
    });
    const timer = setInterval(
      () => realtime.refresh().catch(() => {}),
      3600000,
    );
    timer.unref?.();
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  });
  let sessions = null;
  if (typeof ctx.inject === "function") {
    ctx.inject(["sessions"], (scope) => {
      sessions = scope.sessions;
      scope.effect(() => () => {
        sessions = null;
      });
    });
  }
  let agents = null;
  const companionEvents = createCompanionEvents();
  ctx.effect(() =>
    ctx.on("agent/status", (payload) => companionEvents.started(payload)),
  );
  const scheduler = createPeakScheduler({
    getAgents: () => agents?.list?.() || [],
    directory:
      config?.scheduler?.directory ||
      config?.inventory?.directory ||
      join(homedir(), ".dsh", "dsh-kujira"),
    getConfig: () => billingConfig || realtime.pricing(),
    preview: !!config?.scheduler?.preview,
    now: config?.scheduler?.now || Date.now,
  });
  ctx.inject?.(["agents"], (scope) => {
    agents = scope.agents;
    scheduler.setAvailable(!!agents);
    scope.effect(() => () => {
      agents = null;
      scheduler.setAvailable(false);
    });
  });
  ctx.effect(() =>
    ctx.on("agent/pre-step", (payload, next) => scheduler.gate(payload, next), {
      prepend: true,
    }),
  );
  ctx.effect(() =>
    ctx.on("agent/request", (payload, next) => scheduler.gate(payload, next), {
      prepend: true,
    }),
  );
  ctx.effect(() => () => scheduler.dispose());
  let sessionController = null;
  const sessionAccess = createSessionAccess(
    () => sessions,
    () => sessionController,
  );
  ctx.inject?.(["sessionController"], (scope) => {
    sessionController = scope.sessionController;
    scope.effect(() => () => {
      sessionController = null;
      sessionAccess.clear();
    });
  });
  ctx.effect(() => () => sessionAccess.clear());
  const activityReader = createActivityReader(() => sessionAccess);
  ctx.effect(() =>
    ctx.on("session/event", (session, event) =>
      activityReader.observe(session, event),
    ),
  );
  ctx.effect(() =>
    ctx.on("subagent/end", (info) => activityReader.settled(info)),
  );
  const queryUsage = createUsageReader(
    () => sessionAccess,
    () => billingConfig || realtime.pricing(),
  );

  let configSnapshot, configRead;
  async function loadConfig() {
    if (configRead) return configRead;
    configRead = (async () => {
      const info = await stat(CONFIG_FILE),
        fingerprint = `${info.mtimeMs}:${info.size}`;
      if (configSnapshot?.fingerprint === fingerprint) return configSnapshot;
      const raw = await readFile(CONFIG_FILE, "utf8"),
        parsed = JSON.parse(raw);
      growthEnabled = parsed.growth?.enabled !== false;
      ttlOverride = parsed.state?.ttl || {};
      careConfig = parsed.care || {};
      billingConfig = parsed.billing ? { ...PRICING, ...parsed.billing } : null;
      configSnapshot = { raw, parsed, fingerprint };
      return configSnapshot;
    })().finally(() => {
      configRead = null;
    });
    return configRead;
  }
  async function reloadConfig() {
    try {
      await loadConfig();
    } catch (error) {
      // 配置坏了就用默认值，绝不因此阻塞插件
      ttlOverride = {};
      careConfig = {};
    }
  }

  // 启动读一次
  reloadConfig().catch(() => {});

  // 同步取 TTL 覆盖（事件回调里用）。
  const getTtl = () => ttlOverride;

  // ------------------------------------------------------------------
  // 2. 会话观察器 / 余额客户端 / 天气客户端
  // ------------------------------------------------------------------
  const watch = createSessionWatch(ctx, getTtl);
  const queryBalance = createBalanceClient(ctx);
  const exchange = createExchangeClient({ disabled: config?.exchangeRates?.enabled === false });
  ctx.effect(() => () => exchange.dispose());
  const inventory = createInventory({
    directory: config?.inventory?.directory,
    now: config?.inventory?.now || Date.now,
    getConfig: () => billingConfig || realtime.pricing(),
    enabled: () => growthEnabled,
    isBusy: () =>
      ["thinking", "working", "result"].includes(watch.snapshot().state),
  });
  const settlementObserver = createSettlementObserver(
    (session) => inventory.observe(session),
    {
      onError: (error) =>
        console.warn(
          "[dsh-kujira] Inventory persistence failed:",
          error.code || error.message,
        ),
    },
  );
  ctx.effect(() => async () => {
    await settlementObserver.dispose();
    await inventory.dispose();
  });
  ctx.effect(() =>
    ctx.on("session/event", (session, event) => {
      queryUsage.invalidate(session?.header?.id || session?.id);
      sessionAccess.invalidate(session?.header?.id || session?.id);
      if (
        ["assistant/message", "assistant/attempt", "turn/end"].includes(
          event?.type,
        )
      ) {
        const live =
          typeof session?.snapshotEvents === "function"
            ? session
            : sessions?.get(session?.header?.id || session?.id);
        if (live) settlementObserver.enqueue(live);
      }
    }),
  );

  // 天气的城市名由浏览器通过 query 传上来，这里只记住最后一次，用于日志。
  let lastCity = "";
  const queryWeather = createWeatherClient(() => lastCity);

  // ------------------------------------------------------------------
  // 3. 路由
  // ------------------------------------------------------------------
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: ROUTE_PREFIX,

        handler: createRouteHandler({
          PACKAGE_ROOT,
          ROUTE_PREFIX,
          ctx,
          realtime,
          inventory,
          companionEvents,
          getAgents: () => agents,
          scheduler,
          sessionAccess,
          activityReader,
          queryUsage,
          loadConfig,
          reloadConfig,
          watch,
          queryBalance,
          queryExchange: exchange.query,
          queryWeather,
          setCity: (value) => {
            lastCity = value;
          },
          getCare: () => careConfig,
        }),
      }),
    "dsh-kujira: /dsh-kujira/* 资源与数据路由",
  );

  console.log("[dsh-kujira] 已挂载 " + ROUTE_PREFIX + "/");
  console.log(
    "[dsh-kujira]   /config.json  /anim/*  /shared/*  /state  /balance  /weather  /meta",
  );
}
