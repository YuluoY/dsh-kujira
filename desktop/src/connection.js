import { randomUUID } from "node:crypto";
import { probeDsh } from "./dsh-service.js";

const DATA_ROUTES = new Set([
  "state",
  "inventory",
  "activity",
  "usage",
  "balance",
  "weather",
  "exchange",
  "realtime",
  "scheduler",
  "meta",
]);
import { boundedText } from "./http.js";
export { boundedText } from "./http.js";

/**
 * @description Own one desktop lease and gate all renderer data access behind local identity checks.
 */
export function createConnection({ getSettings, onState, fetcher = fetch }) {
  const owner = randomUUID();
  let legacy = false,
    instance = null;
  let online = false,
    presence = null,
    timer,
    disposed = false,
    wanted = true,
    ready = false,
    visible = true,
    failures = 0,
    inflight = null;
  const snapshot = () => ({ online, presence, legacy });
  const post = async (body) => {
    const response = await fetcher(
      getSettings().dshUrl + "/dsh-kujira/desktop",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Kujira-Desktop": "1",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(2500),
        redirect: "error",
      },
    );
    if (!response.ok) throw Error("handoff-conflict");
    return JSON.parse(await boundedText(response, 32768));
  };
  const tick = () => {
    if (inflight) return inflight;
    inflight = (async () => {
      const result = await probeDsh(getSettings().dshUrl, fetcher);
      online = result.online;
      legacy = !!result.legacy;
      presence = result.presence || null;
      if (presence && instance !== presence.instance) {
        if (ready && visible) wanted = true;
        instance = presence.instance;
      }
      if (online) {
        failures = 0;
        try {
          if (wanted && ready && visible) {
            presence = await post({ action: "request", mode: "desktop" });
            wanted = false;
          }
          if (ready && visible && presence.desired === "desktop")
            presence = await post({
              action: "claim",
              owner,
              revision: presence.revision,
            });
          else if (ready && visible && presence.desktopActive)
            presence = await post({ action: "heartbeat", owner });
        } catch {
          /* A second owner or a newer browser request keeps its lease. */
        }
      } else failures++;
      if (!disposed) onState(snapshot());
    })().finally(() => {
      inflight = null;
      if (!disposed) {
        clearTimeout(timer);
        timer = setTimeout(
          tick,
          online
            ? visible
              ? 3000
              : 30000
            : Math.min(30000, 2000 * 2 ** Math.min(failures, 4)),
        );
      }
    });
    return inflight;
  };
  const proxy = async (request, route) => {
    const path = route.split("?")[0];
    if (!DATA_ROUTES.has(path) || !["GET", "POST"].includes(request.method))
      return new Response("", { status: 404 });
    if (!online)
      return Response.json(
        { ok: false, offline: true, message: "DSH 未连接" },
        { status: 503 },
      );
    const body = request.method === "POST" ? await request.text() : undefined;
    if (body?.length > 16384) return new Response("", { status: 413 });
    const headers = {};
    for (const name of [
      "content-type",
      "x-kujira-inventory",
      "x-kujira-settings",
      "x-kujira-scheduler",
      "if-none-match",
    ]) {
      const value = request.headers.get(name);
      if (value) headers[name] = value;
    }
    try {
      const result = await fetcher(
        getSettings().dshUrl + "/dsh-kujira/" + route,
        {
          method: request.method,
          headers,
          body,
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        },
      );
      if (result.status === 304) return new Response(null, { status: 304 });
      const text = await boundedText(result);
      return new Response(text, {
        status: result.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          ...(result.headers.get("etag")
            ? { etag: result.headers.get("etag") }
            : {}),
        },
      });
    } catch {
      return Response.json(
        { ok: false, offline: true, message: "DSH 连接中断" },
        { status: 503 },
      );
    }
  };
  return {
    snapshot,
    navigate: (target) => post({ action: "navigate", target }),
    navigationStatus: (id) => post({ action: "navigation-status", id }),
    tick,
    proxy,
    setReady: () => {
      ready = true;
      return tick();
    },
    activate: () => {
      wanted = presence?.desired !== "desktop";
      visible = true;
      return tick();
    },
    standby: async () => {
      visible = false;
      if (online) await post({ action: "release", owner }).catch(() => {});
    },
    toBrowser: async (preferences) => {
      if (!online) throw Error("dsh-offline");
      presence = await post({
        action: "request",
        mode: "browser",
        preferences,
      });
      onState(snapshot());
      return presence;
    },
    reset: async () => {
      clearTimeout(timer);
      if (inflight) await inflight;
      clearTimeout(timer);
      if (online) await post({ action: "release", owner }).catch(() => {});
      online = false;
      presence = null;
      wanted = true;
    },
    dispose: async () => {
      disposed = true;
      clearTimeout(timer);
      if (inflight) await inflight;
      if (online) await post({ action: "release", owner }).catch(() => {});
    },
  };
}
