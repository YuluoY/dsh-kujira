import { createInventoryEngine } from "./inventory-engine.js";

const engines = new Map();
let queue = Promise.resolve();

/**
 * @description Serialize worker commands and bound open database connections.
 * @param {object} request Storage directory, operation and command context.
 * @returns {Promise<object>} Committed inventory result.
 */
export function executeInventory(request) {
  const task = queue.then(async () => {
    const { directory, action, args = [], context } = request;
    let entry = engines.get(directory);
    if (action === "close") {
      entry?.engine.dispose();
      engines.delete(directory);
      return { ok: true };
    }
    if (!entry) {
      entry = { context };
      entry.engine = createInventoryEngine({
        directory,
        startedAt: context.startedAt,
        now: () => entry.context.now,
        getConfig: () => entry.context.config,
        enabled: () => entry.context.enabled,
        isBusy: () => entry.context.busy,
        random: (n) => entry.context.random?.(n),
      });
    }
    entry.context = context;
    engines.delete(directory);
    engines.set(directory, entry);
    while (engines.size > 8) {
      const oldest = engines.keys().next().value;
      engines.get(oldest).engine.dispose();
      engines.delete(oldest);
    }
    if (
      ![
        "snapshot",
        "observe",
        "consume",
        "configure",
        "configureRules",
      ].includes(action)
    )
      throw Error("invalid-inventory-operation");
    return entry.engine[action](...args);
  });
  queue = task.catch(() => {});
  return task;
}
