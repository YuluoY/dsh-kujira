import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { createUsageIndex } from "./usage-index.js";
import { sendInventory } from "./inventory-transport.js";
import { PRICING } from "../shared/session-cost.js";

/**
 * @description Send compact inventory commands to transactional storage outside the host event loop.
 * @param {object} options Storage, pricing, clock and interaction constraints.
 * @returns {object} Inventory and settlement operations.
 */
export function createInventory({
  directory = join(homedir(), ".dsh", "dsh-kujira"),
  now = Date.now,
  random,
  getConfig = () => PRICING,
  isBusy = () => false,
  enabled = () => true,
} = {}) {
  const readUsage = createUsageIndex({ mutable: true }),
    observed = new WeakMap();
  const path = resolve(directory);
  const startedAt = now();
  let disposed = false,
    used = false;
  const request = (action, args = []) => {
    if (disposed && action !== "close")
      return Promise.reject(Error("inventory-disposed"));
    used = true;
    const context = {
      now: now(),
      startedAt,
      config: getConfig(),
      enabled: enabled(),
      busy: action === "consume" && isBusy(),
    };
    const command = { directory: path, action, args, context };
    if (random)
      return import("./inventory-service.js").then(({ executeInventory }) =>
        executeInventory({ ...command, context: { ...context, random } }),
      );
    return sendInventory(command);
  };
  return {
    snapshot: () => request("snapshot"),
    configure: (free) => request("configure", [free]),
    configureRules: (rules, revision) =>
      request("configureRules", [rules, revision]),
    consume: (kind, id) => request("consume", [kind, id]),
    async account(session) {
      const id = session?.header?.id || session?.id;
      if (!id || typeof session.snapshotEvents !== "function") return [];
      const records = readUsage(session, getConfig());
      const start = new Date(now());
      start.setHours(0, 0, 0, 0);
      await request("observe", [
        {
          id,
          rows: [...records.rows.values()].filter(
            (row) => row.ts >= start.getTime(),
          ),
          accountOnly: true,
        },
      ]);
      return [...(records.children || [])];
    },
    async observe(session) {
      const id = session?.header?.id || session?.id;
      if (!id || typeof session.snapshotEvents !== "function")
        return request("snapshot");
      const records = readUsage(session, getConfig()),
        seen = observed.get(session);
      if (seen === records.version) return request("snapshot");
      const rows = [
        ...(seen === records.baseVersion
          ? records.changes
          : records.rows
        ).values(),
      ];
      const value = await request("observe", [{ id, rows }]);
      observed.set(session, records.version);
      return value;
    },
    dispose() {
      disposed = true;
      return used ? request("close") : Promise.resolve({ ok: true });
    },
  };
}
