import { parentPort } from "node:worker_threads";
import { executeInventory } from "./inventory-service.js";

parentPort.on("message", ({ id, request }) => {
  executeInventory(request).then(
    (value) => parentPort.postMessage({ id, value }),
    (error) =>
      parentPort.postMessage({
        id,
        error: { message: error.message, code: error.code },
      }),
  );
});
