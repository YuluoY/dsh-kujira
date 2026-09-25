import { sendJson } from "./http.js";

/**
 * @description Restrict installation operations to same-origin requests on the local host.
 * @param {object} req Incoming HTTP request.
 * @returns {boolean} Whether the request can mutate update state.
 */
export function localUpdateRequest(req) {
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket?.remoteAddress) ||
      req.headers["x-kujira-update"] !== "1" || req.headers["sec-fetch-site"] === "cross-site") return false;
  try {
    const host = new URL("http://" + req.headers.host);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host.hostname)) return false;
    return !req.headers.origin || new URL(req.headers.origin).host === host.host;
  } catch { return false; }
}

/**
 * @description Expose bounded update actions without accepting commands, paths or arbitrary packages.
 * @param {object} req Incoming request.
 * @param {object} res Outgoing response.
 * @param {object} updater Host-owned update service.
 * @returns {Promise<void>} Completed response.
 */
export async function handleHarnessUpdate(req, res, updater) {
  if (!updater) { sendJson(res, 503, { ok: false, error: "service-unavailable" }); return; }
  await updater.ready;
  if (req.method === "GET") { sendJson(res, 200, updater.status()); return; }
  if (req.method !== "POST") { sendJson(res, 405, { ok: false }); return; }
  if (!localUpdateRequest(req)) { sendJson(res, 403, { ok: false, error: "local-only" }); return; }
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024) { sendJson(res, 413, { ok: false }); return; }
  }
  try {
    const input = JSON.parse(body);
    let result;
    if (input.action === "check" && Object.keys(input).length === 1) result = await updater.check({ manual: true });
    else if (input.action === "versions" && Object.keys(input).length === 1) result = await updater.listVersions();
    else if (input.action === "switch" && Object.keys(input).every((key) => ["action", "version"].includes(key))) result = await updater.install(input.version, { selected: true });
    else if (input.action === "install" && Object.keys(input).every((key) => ["action", "version"].includes(key))) result = await updater.install(input.version);
    else if (input.action === "repair" && Object.keys(input).length === 1) result = await updater.install(updater.status().installed, { repair: true });
    else if (input.action === "configure" && Object.keys(input).every((key) => ["action", "settings"].includes(key))) result = await updater.configure(input.settings);
    else throw Error("invalid-settings");
    sendJson(res, 200, result);
  } catch (failure) {
    const allowed = ["update-not-ready", "update-busy", "invalid-settings", "save-failed"];
    sendJson(res, 400, { ok: false, error: allowed.includes(failure.message) ? failure.message : "invalid-settings" });
  }
}
