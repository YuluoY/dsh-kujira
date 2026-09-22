/**
 * @description Restore persisted preferences before mount and mirror every confirmed storage change.
 * @param {object} options Native API, local snapshot adapters and lifecycle events.
 * @returns {Promise<object>} Persistence flush and cleanup operations.
 */
export async function connectPreferencePersistence({ api, capture, restore, events = window, doc = document,
  report = () => console.warn("[kujira] Desktop preference backup failed") }) {
  let stopped = false, restoring = false, pending = null, latest = null, saved = "";
  let flushAgain = false;
  const persist = () => {
    if (stopped || restoring) return pending || Promise.resolve();
    latest = capture();
    if (!latest || JSON.stringify(latest) === saved) return pending || Promise.resolve();
    flushAgain = true;
    if (pending) return pending;
    pending = (async () => {
      while (flushAgain) {
        flushAgain = false;
        const value = latest, body = JSON.stringify(value);
        if (body === saved) continue;
        try {
          await api.savePreferences(value);
          saved = body;
        } catch {
          report();
          break;
        }
      }
    })().finally(() => { pending = null; });
    return pending;
  };
  const apply = (value, preservePosition) => {
    restoring = true;
    try { return restore(value, { preservePosition }); }
    finally { restoring = false; }
  };
  let incoming = null, initialized = false;
  const stopPreferences = api.onPreferences((value) => {
    if (!initialized) { incoming = value; return; }
    if (apply(value, true)) persist();
  });
  let backup = null;
  try { backup = await api.readPreferences(); }
  catch { report(); }
  const local = capture();
  if (backup && (!local || (Number(backup.__updatedAt) > 0 && Number(backup.__updatedAt) >= (Number(local.__updatedAt) || 0))))
    apply(backup, false);
  initialized = true;
  if (incoming) apply(incoming, true);
  saved = JSON.stringify(backup);
  events.addEventListener("kujira:storage", persist);
  events.addEventListener("pagehide", persist);
  const onHidden = () => { if (doc.hidden) persist(); };
  doc.addEventListener("visibilitychange", onHidden);
  const stopFlush = api.onFlushPreferences(async (id) => {
    await persist();
    api.preferencesFlushed(id);
  });
  await persist();
  return {
    flush: persist,
    dispose() {
      persist();
      stopped = true;
      stopPreferences(); stopFlush();
      events.removeEventListener("kujira:storage", persist);
      events.removeEventListener("pagehide", persist);
      doc.removeEventListener("visibilitychange", onHidden);
    },
  };
}
