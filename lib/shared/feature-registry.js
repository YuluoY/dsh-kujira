const reserved = new Set([
  "balance",
  "weather",
  "growth",
  "feed",
  "settings",
  "github",
  "__more",
]);
const entries = new Map(),
  listeners = new Set();
let snapshot = [];
const publish = () => {
  snapshot = Object.freeze([...entries.values()].sort((a, b) => a.order - b.order));
  for (const listener of listeners) listener(snapshot);
};
/**
 * @description Register a third-party radial action; dispose removes it from every mounted mascot.
 * @param {{id:string,label:string,iconPath:string,href?:string,onActivate?:Function,order?:number}} feature Action definition.
 * @returns {Function} Unregister callback owned by the registering plugin.
 */
export function registerFeature(feature) {
  if (
    !feature ||
    !/^[a-z][a-z0-9.-]{1,63}$/.test(feature.id) ||
    reserved.has(feature.id)
  )
    throw Error("Invalid or reserved feature id");
  if (entries.has(feature.id)) throw Error("Feature already registered");
  if (
    typeof feature.label !== "string" ||
    !feature.label.trim() ||
    feature.label.length > 80
  )
    throw Error("Invalid feature label");
  if (
    typeof feature.iconPath !== "string" ||
    feature.iconPath.length > 4000 ||
    !/^[MmLlHhVvCcSsQqTtAaZz0-9.,+\-\s]+$/.test(feature.iconPath)
  )
    throw Error("Invalid SVG path");
  if (feature.href && !/^https?:$/.test(new URL(feature.href).protocol))
    throw Error("Unsupported feature URL");
  if (!feature.href && typeof feature.onActivate !== "function")
    throw Error("An action or URL is required");
  const entry = Object.freeze({
    ...feature,
    key: feature.id,
    kind: "extension",
    order: Number.isFinite(feature.order) ? feature.order : 100,
  });
  entries.set(entry.id, entry);
  publish();
  return () => {
    if (entries.get(entry.id) === entry) {
      entries.delete(entry.id);
      publish();
    }
  };
}
/**
 * @description Read registered external actions without mutating the registry.
 * @returns {Array} Stable registry snapshot.
 */
export function getFeatures() {
  return snapshot;
}
/**
 * @description Subscribe to external action registration and disposal.
 * @param {Function} listener Snapshot listener.
 * @returns {Function} Subscription disposer.
 */
export function subscribeFeatures(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
/**
 * @description Resolve a bounded menu size, including its More button.
 * @param {unknown} value Saved preference.
 * @returns {number} Button limit.
 */
export function menuLimit(value) {
  return Math.max(3, Math.min(8, Math.floor(Number(value) || 6)));
}
