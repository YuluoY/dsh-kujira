import { Worker } from "node:worker_threads";

let worker = null,
  sequence = 0;
const pending = new Map();
const start = () => {
  if (worker) return worker;
  const current = new Worker(
    new URL("./inventory-worker.js", import.meta.url),
    {
      execArgv: [],
    },
  );
  worker = current;
  const fail = (error) => {
    if (worker !== current) return;
    worker = null;
    for (const item of pending.values()) item.reject(error);
    pending.clear();
  };
  current.on("error", fail);
  current.on("exit", (code) => fail(Error("inventory-worker-exited-" + code)));
  current.on("message", ({ id, value, error }) => {
    const item = pending.get(id);
    if (!item) return;
    pending.delete(id);
    if (error)
      item.reject(Object.assign(Error(error.message), { code: error.code }));
    else item.resolve(value);
    if (!pending.size) current.unref();
  });
  return current;
};

/**
 * @description Dispatch a storage command to the shared inventory worker.
 * @param {object} request Serializable operation and context.
 * @returns {Promise<object>} Committed response or storage failure.
 */
export function sendInventory(request) {
  return new Promise((resolve, reject) => {
    const current = start(),
      id = ++sequence;
    current.ref();
    pending.set(id, { resolve, reject });
    try {
      current.postMessage({ id, request });
    } catch (error) {
      pending.delete(id);
      if (!pending.size) current.unref();
      reject(error);
    }
  });
}
