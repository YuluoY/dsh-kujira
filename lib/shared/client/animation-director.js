import { scenePool } from "./animation-catalog.js";
import { calendarScenes } from "./animation-calendar.js";

/**
 * @description Select idle scenes with bounded history and per-scene cooldowns.
 * @param {object} options Injectable clock and randomness.
 * @returns {object} Idle selection and explicit scene selection.
 */
export function createAnimationDirector({
  now = Date.now,
  random = Math.random,
} = {}) {
  const recent = [],
    seen = new Map();
  let lastContext = -Infinity;
  const pick = (list) => {
    if (!list?.length) return null;
    const fresh = list.filter((n) => !recent.includes(n));
    const choices = fresh.length
      ? fresh
      : list.filter((n) => n !== recent.at(-1));
    const pool = choices.length ? choices : list;
    const name =
      pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
    recent.push(name);
    if (recent.length > 8) recent.shift();
    return name;
  };
  return {
    scene: (config, key) => pick(scenePool(config, key)),
    next({ config, prefs = {}, growth, weather, date = new Date(now()) }) {
      const time = now(),
        hour = date.getHours(),
        c = config;
      if (prefs.contextualReactions !== false && time - lastContext >= 90000) {
        const candidates = [],
          calendar = calendarScenes(date);
        const offer = (
          key,
          gap,
          pool = scenePool(c, key),
          sequence = false,
        ) => {
          if (pool.length && time - (seen.get(key) ?? -Infinity) >= gap)
            candidates.push({ key, pool, sequence });
        };
        if ((hour >= 23 || hour < 6) && random() < 0.2)
          offer("sleep", 600000, c.pools.sleep, true);
        if (growth?.energy < 20) offer("tired", 600000);
        if (growth?.satiety < 25) offer("hungry", 600000);
        if (growth?.mood < 25) offer("bored", 600000);
        if (calendar.festival) offer(calendar.festival, 900000);
        if (hour >= 6 && hour < 10) offer("morning", 3600000);
        if (hour >= 7 && hour < 10) offer("breakfast", 3600000);
        if (hour >= 11 && hour < 14) offer("lunch", 3600000);
        if (hour >= 18 && hour < 21) offer("dinner", 3600000);
        if (hour >= 14 && hour < 17) offer("snack", 3600000);
        if (
          weather?.ok &&
          !weather.stale &&
          !weather.loading &&
          Number.isFinite(weather.now?.temp)
        ) {
          if (weather.now.temp >= 28) offer("warm", 900000);
          if (weather.now.temp <= 8) offer("cold", 900000);
        }
        offer(calendar.season, 1200000);
        if (hour >= 8 && hour < 22) offer("tidy", 1800000);
        if (candidates.length) {
          const item =
            candidates[
              Math.min(
                candidates.length - 1,
                Math.floor(random() * candidates.length),
              )
            ];
          seen.set(item.key, time);
          lastContext = time;
          return {
            scene: item.key,
            clips: item.sequence ? [...item.pool] : [pick(item.pool)],
          };
        }
      }
      const r = random(),
        weights = c.weights;
      const key =
        r < weights.idle
          ? "idle"
          : r < weights.idle + weights.action
            ? "action"
            : "long";
      const pool =
        key === "long" && prefs.playful !== false
          ? [...(c.pools.long || []), ...scenePool(c, "play")]
          : c.pools[key];
      return { scene: key, clips: [pick(pool) || c.startAnim] };
    },
  };
}
