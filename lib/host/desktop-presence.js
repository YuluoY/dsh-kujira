import { randomUUID } from "node:crypto";
import { sendJson } from "./http.js";

/**
 * @description Coordinate acknowledged display handoff with an expiring desktop lease.
 * @param {object} options Clock dependency.
 * @returns {object} In-memory presence service, with no background timers.
 */
export function createDesktopPresence({ now = Date.now } = {}) {
  const instance = randomUUID();
  let owner = "",
    expires = 0,
    desired = "browser",
    revision = 0,
    browserReady = false;
  let preferences = null,
    preferencesRevision = -1;
  const browsers = new Map();
  let navigation = null;
  const activeBrowsers = () => {
    for (const [id, tab] of browsers)
      if (now() - tab.seen > 90000) browsers.delete(id);
    return [...browsers.values()].sort(
      (a, b) => Number(b.visible) - Number(a.visible) || b.seen - a.seen,
    );
  };
  const snapshot = () => ({
    ok: true,
    product: "dsh-kujira",
    protocol: 1,
    instance,
    desired,
    revision,
    desktopActive: !!owner && expires > now(),
    browserReady,
    preferences,
    preferencesRevision,
    browserCount: activeBrowsers().length,
    browserBackKind: activeBrowsers()[0]?.backKind || null,
    browserSessionId:
      activeBrowsers().find((tab) => tab.sessionId)?.sessionId || null,
  });
  const update = (input) => {
    if (input.action === "browser-close") {
      browsers.delete(input.client);
      return snapshot();
    }
    if (input.action === "browser-poll") {
      if (
        typeof input.client !== "string" ||
        !/^[a-zA-Z0-9-]{16,80}$/.test(input.client)
      )
        return null;
      activeBrowsers();
      if (browsers.size >= 16 && !browsers.has(input.client)) return null;
      browsers.set(input.client, {
        id: input.client,
        seen: now(),
        visible: input.visible === true,
        backKind: ["message", "child"].includes(input.backKind)
          ? input.backKind
          : null,
        sessionId:
          typeof input.sessionId === "string" && input.sessionId.length < 200
            ? input.sessionId
            : null,
        browser: ["chrome", "edge", "firefox", "safari", "codex"].includes(
          input.browser,
        )
          ? input.browser
          : "",
      });
      if (navigation && !navigation.client && navigation.expires > now())
        navigation.client = input.client;
      return {
        ...snapshot(),
        focusReleased: navigation?.client === input.client && navigation.focusReleased ? navigation.id : null,
        navigation:
          navigation?.client === input.client &&
          navigation.expires > now() &&
          !navigation.done
            ? navigation
            : null,
      };
    }
    if (input.action === "navigate") {
      if (navigation && !navigation.done && navigation.expires > now())
        return null;
      const target = input.target;
      if (
        !target ||
        !["web", "session", "file", "message", "child", "back"].includes(target.kind) ||
        JSON.stringify(target).length > 12000
      )
        return null;
      if (
        target.kind !== "web" &&
        (typeof target.sessionId !== "string" || !target.sessionId)
      )
        return null;
      const tab = activeBrowsers()[0];
      const client = tab?.id;
      navigation = {
        id: randomUUID(),
        client: client || null,
        target,
        expires: now() + 15000,
        done: false,
      };
      return {
        ...snapshot(),
        navigationId: navigation.id,
        reused: !!client,
        browser: tab?.browser || "",
      };
    }
    if (input.action === "navigation-ack") {
      if (navigation?.id !== input.id || navigation.client !== input.client || navigation.expires <= now() || navigation.done)
        return null;
      navigation.done = true;
      navigation.success = input.success === true;
      navigation.focusToken = input.focusToken === navigation.id ? navigation.id : null;
      navigation.focused = input.focused === true;
      return snapshot();
    }
    if (input.action === "navigation-status") {
      return {
        ...snapshot(),
        result:
          navigation?.id === input.id
            ? {
                done: navigation.done,
                success: navigation.success,
                focusToken: navigation.focusToken,
                focused: navigation.focused,
                expired: navigation.expires <= now(),
              }
            : null,
      };
    }
    if (input.action === "navigation-finish") {
      if (navigation?.id !== input.id || !navigation.done) return null;
      navigation.focusReleased = true;
      return snapshot();
    }
    if (input.action === "request") {
      if (!["desktop", "browser"].includes(input.mode)) return null;
      desired = input.mode;
      browserReady = false;
      revision++;
      if (
        input.preferences &&
        typeof input.preferences === "object" &&
        !Array.isArray(input.preferences)
      ) {
        preferences = input.preferences;
        preferencesRevision = revision;
      }
    } else if (input.action === "claim") {
      if (
        typeof input.owner !== "string" ||
        !/^[a-zA-Z0-9-]{16,80}$/.test(input.owner)
      )
        return null;
      if (
        input.revision !== revision ||
        desired !== "desktop" ||
        (expires > now() && owner !== input.owner)
      )
        return null;
      owner = input.owner;
      expires = now() + 12000;
    } else if (input.action === "heartbeat") {
      if (!owner || input.owner !== owner || expires <= now()) return null;
      expires = now() + 12000;
    } else if (input.action === "release") {
      if (input.owner !== owner) return null;
      owner = "";
      expires = 0;
    } else if (input.action === "browser-ready") {
      if (desired !== "browser" || input.revision !== revision) return null;
      browserReady = true;
    } else return null;
    return snapshot();
  };
  const handle = async (req, res) => {
    if (req.method === "GET") {
      sendJson(res, 200, snapshot());
      return;
    }
    const remote = req.socket?.remoteAddress;
    if (
      req.method !== "POST" ||
      req.headers["x-kujira-desktop"] !== "1" ||
      (remote && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)) ||
      (req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}` &&
        req.headers.origin !== `https://${req.headers.host}`)
    ) {
      sendJson(res, 403, { ok: false });
      return;
    }
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 128 * 1024) {
          sendJson(res, 413, { ok: false });
          return;
        }
      }
      const value = update(JSON.parse(body));
      sendJson(res, value ? 200 : 409, value || { ok: false });
    } catch {
      sendJson(res, 400, { ok: false });
    }
  };
  return { snapshot, update, handle };
}
