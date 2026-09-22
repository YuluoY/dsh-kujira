/**
 * @description Await a bounded renderer save acknowledgement before closing or handing off.
 * @param {object} options Renderer sender and timeout duration.
 * @returns {object} Coalesced flush and acknowledgement handlers.
 */
export function createPreferenceFlush({ send, timeout = 2000 }) {
  let sequence = 0, pending = null, finish;
  return {
    flush() {
      if (pending) return pending;
      const id = ++sequence;
      let complete;
      pending = new Promise((resolve) => { complete = resolve; });
      const timer = setTimeout(() => finish(id), timeout);
      finish = (received) => {
        if (received !== id) return;
        clearTimeout(timer);
        pending = null;
        complete();
      };
      const result = pending;
      try { send(id); }
      catch { finish(id); }
      return result;
    },
    acknowledge(id) { finish?.(id); },
  };
}

/**
 * @description Persist only snapshots at least as recent as already queued native writes.
 * @param {object} store Serialized native settings store.
 * @param {object} value Renderer snapshot.
 * @returns {Promise<boolean>} Whether the snapshot was accepted.
 */
export async function savePreferenceSnapshot(store, value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Buffer.byteLength(JSON.stringify(value)) > 128 * 1024) throw Error("invalid-preferences");
  const captured = structuredClone(value);
  let accepted = false;
  await store.save((current) => {
    if ((Number(current.preferences?.__updatedAt) || 0) > (Number(captured.__updatedAt) || 0)) return null;
    accepted = true;
    return { preferences: captured };
  });
  return accepted;
}
