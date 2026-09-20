/**
 * @description Start DSH if needed, then reuse an acknowledged browser tab or open one page.
 * @param {object} options Connection, service launch, browser focus and clock adapters.
 * @returns {Function} Serialized desktop-to-web navigation.
 */
export function createWebNavigation({ connection, service, focus, now = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  let pending, pendingTarget;
  return (target) => {
    if (!target || !["web", "session", "file", "message", "child", "back"].includes(target.kind) || JSON.stringify(target).length > 12000)
      return Promise.reject(Error("invalid-navigation"));
    const key = JSON.stringify(target);
    if (pending) return key === pendingTarget ? pending : Promise.reject(Error("web-navigation-busy"));
    pendingTarget = key;
    pending = (async () => {
      await connection.tick();
      if (!connection.snapshot().online) {
        await service.ensureRunning();
        await connection.tick();
        if (!connection.snapshot().online) {
          if (target.kind !== "web") throw Error("desktop-host-needs-restart");
          await service.openWeb();
          return { success: true, reused: false };
        }
      }
      const command = await connection.navigate(target);
      if (!command.reused) await service.openWeb();
      const deadline = now() + 12000;
      while (now() < deadline) {
        const value = await connection.navigationStatus(command.navigationId);
        if (value.result?.done) {
          try {
            if (value.result.success && command.reused && !value.result.focused &&
              !await focus(command.browser, value.result.focusToken)) throw Error("browser-focus-failed");
            return { success: value.result.success, reused: command.reused };
          } finally {
            await connection.finishNavigation?.(command.navigationId).catch(() => {});
          }
        }
        if (value.result?.expired) break;
        await wait(300);
      }
      return { success: false, reused: command.reused };
    })().finally(() => { pending = null; pendingTarget = null; });
    return pending;
  };
}
