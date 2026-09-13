import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { rateAt, nextSwitch } from "../shared/billing.js";
import { PRICING } from "../shared/session-cost.js";

/**
 * @description Resolve both session and registry identities for one live agent.
 * @param {object} agent Host agent.
 * @returns {string[]} Canonical session identity followed by aliases.
 */
export function agentIdentities(agent) {
  return [
    ...new Set(
      [agent?.session?.header?.id, agent?.session?.id, agent?.id].filter(
        (id) => typeof id === "string" && id.length,
      ),
    ),
  ];
}

/**
 * @description Gate original step and request continuations during peak pricing.
 * @param {object} options Storage, pricing, clock and live-agent accessors.
 * @returns {object} Persisted switch, live pause state and continuation gates.
 */
export function createPeakScheduler({
  directory,
  now = Date.now,
  getConfig = () => PRICING,
  available = false,
  preview = false,
  tickMs = 1000,
  getAgents = () => [],
}) {
  const file = join(directory, "peak-scheduler.json"),
    waiting = new Map(),
    counts = new Map();
  let enabled = false,
    disposed = false,
    error = "",
    serial = Promise.resolve(),
    tariffCache;
  const ready = readFile(file, "utf8")
    .then((text) => {
      const value = JSON.parse(text);
      if (typeof value.enabled !== "boolean") throw Error();
      enabled = value.enabled;
    })
    .catch((e) => {
      if (e.code !== "ENOENT") error = "调度设置读取失败，请重新保存";
    });
  const tariff = () => {
    const time = now();
    let config;
    try {
      const source = getConfig();
      config = {
        peakHours: source?.peakHours ?? [
          [9, 12],
          [14, 18],
        ],
        workdays: source?.workdays ?? [1, 2, 3, 4, 5],
      };
      if (
        !Array.isArray(config.peakHours) ||
        !config.peakHours.every(
          (range) =>
            Array.isArray(range) &&
            range.length === 2 &&
            range.every(Number.isInteger) &&
            range[0] >= 0 &&
            range[0] < range[1] &&
            range[1] <= 24,
        ) ||
        !Array.isArray(config.workdays) ||
        !config.workdays.every(
          (day) => Number.isInteger(day) && day >= 0 && day <= 6,
        )
      )
        throw Error();
    } catch {
      error = "峰谷规则无效，请检查配置";
      tariffCache = null;
      return { rate: "unknown", nextAt: null };
    }
    if (error === "峰谷规则无效，请检查配置") error = "";
    const key = JSON.stringify([config.peakHours, config.workdays]);
    if (
      tariffCache?.key === key &&
      time >= tariffCache.from &&
      time < tariffCache.until
    )
      return tariffCache;
    const next = nextSwitch(time, config);
    tariffCache = {
      key,
      from: time,
      until: time + (next.ms ?? 86400000),
      rate: rateAt(time, config),
      nextAt: next.ms == null ? null : time + next.ms,
    };
    return tariffCache;
  };
  const paused = (id) => !!id && (counts.get(id) || 0) > 0;
  const mustHold = () =>
    !disposed && available && enabled && tariff().rate !== "offpeak";
  const releaseAll = () => {
    for (const item of [...waiting.values()]) item.release();
  };
  const tick = () => {
    if (!mustHold()) releaseAll();
  };
  const timer = setInterval(tick, Math.max(10, tickMs));
  timer.unref?.();
  const sessionState = (id) => {
    const period = tariff(),
      isPaused = paused(id);
    const running = getAgents().some(
      (agent) =>
        agent.status === "running" && agentIdentities(agent).includes(id),
    );
    return {
      paused: isPaused,
      pausing:
        !isPaused &&
        running &&
        enabled &&
        available &&
        period.rate !== "offpeak",
      resumeAt: isPaused ? period.nextAt : null,
      enabled,
      available,
      rate: period.rate,
    };
  };
  const snapshot = () => {
    const period = tariff();
    return {
      ok: true,
      enabled,
      available,
      preview,
      rate: period.rate,
      nextAt: period.nextAt,
      pausing:
        enabled && available && period.rate !== "offpeak"
          ? getAgents().filter(
              (agent) =>
                agent.status === "running" &&
                !agentIdentities(agent).some(paused),
            ).length
          : 0,
      paused: new Set([...waiting.values()].map((item) => item.id)).size,
      error,
    };
  };
  const configure = (value) => {
    const work = serial.then(async () => {
      await ready;
      if (disposed) throw Error("scheduler-disposed");
      if (typeof value !== "boolean") throw Error("invalid-setting");
      if (value && !available) throw Error("scheduler-unavailable");
      await mkdir(directory, { recursive: true });
      const temp = file + ".tmp";
      await writeFile(
        temp,
        JSON.stringify({ version: 1, enabled: value }) + "\n",
        { mode: 0o600 },
      );
      await rename(temp, file);
      enabled = value;
      error = "";
      tick();
      return snapshot();
    });
    serial = work.catch(() => {});
    return work;
  };
  async function hold(payload) {
    const signal = payload.signal;
    while (mustHold()) {
      if (signal?.aborted) throw signal.reason || Error("aborted");
      await new Promise((resolve, reject) => {
        const token = {},
          aliases = agentIdentities(payload.agent);
        const id = aliases[0] || token;
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          waiting.delete(token);
          if (!waiting.size) timer.unref?.();
          for (const alias of aliases) {
            const n = (counts.get(alias) || 1) - 1;
            if (n) counts.set(alias, n);
            else counts.delete(alias);
          }
          signal?.removeEventListener("abort", abort);
          if (error) reject(error);
          else resolve();
        };
        const abort = () => finish(signal.reason || Error("aborted"));
        waiting.set(token, { id, release: () => finish() });
        timer.ref?.();
        for (const alias of aliases)
          counts.set(alias, (counts.get(alias) || 0) + 1);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
    if (signal?.aborted) throw signal.reason || Error("aborted");
  }
  async function gate(payload, next) {
    await ready;
    await hold(payload);
    const decision = await next();
    if (decision?.kind === "reject") return decision;
    await hold(payload);
    return decision;
  }
  return {
    ready,
    snapshot,
    configure,
    gate,
    tick,
    paused,
    sessionState,
    setAvailable: (value) => {
      available = !!value;
      tick();
    },
    dispose: () => {
      disposed = true;
      clearInterval(timer);
      releaseAll();
    },
  };
}
