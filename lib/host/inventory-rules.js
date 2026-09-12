import { randomInt } from "node:crypto";

export const ITEM_KINDS = ["fish", "pat", "play", "stretch"];
export const REWARD_DEFAULTS = Object.freeze({
  amount: 0.1,
  chance: 25,
  min: 1,
  max: 3,
  fishWeight: 50,
  peakBonus: true,
});
/**
 * @description Validate a complete rule set; quantities and percentages are integral.
 * @param {object} value Submitted rules.
 * @returns {object|null} Canonical rules or rejection.
 */
export function rewardRules(value) {
  if (!value || typeof value !== "object") return null;
  const { amount, chance, min, max, fishWeight, peakBonus } = value;
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount < 0.01 ||
    amount > 100 ||
    Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7 ||
    ![chance, min, max, fishWeight].every(Number.isInteger) ||
    chance < 0 ||
    chance > 100 ||
    min < 1 ||
    max > 20 ||
    min > max ||
    fishWeight < 0 ||
    fishWeight > 100 ||
    typeof peakBonus !== "boolean"
  )
    return null;
  return {
    amount: Math.round(amount * 100) / 100,
    chance,
    min,
    max,
    fishWeight,
    peakBonus,
  };
}
/**
 * @description Migrate legacy deterministic drops without changing inventory or replaying spend.
 * @param {object} state Persisted inventory.
 * @returns {object} Versioned reward progress.
 */
export function rewardState(state) {
  if (state.rewards) {
    const r = state.rewards;
    if (
      !rewardRules(r.rules) ||
      ![r.carry, r.attempts, r.successes, r.revision].every(
        (x) => Number.isSafeInteger(x) && x >= 0,
      ) ||
      r.carry >= Math.round(r.rules.amount * 1e6) ||
      r.successes > r.attempts
    )
      throw Error("invalid-reward-state");
    return r;
  }
  return {
    rules: { ...REWARD_DEFAULTS },
    carry: ((state.credited || 0) + (state.bonusCredited || 0)) % 100000,
    attempts: state.drops || 0,
    successes: state.drops || 0,
    revision: 0,
  };
}
/**
 * @description Sample binomial counts by beta subdivision, avoiding work proportional to billed usage.
 * @param {Function} random Uniform integer source with exclusive upper bound.
 * @returns {Function} Binomial sampler.
 */
export function createBinomial(random = randomInt) {
  const uniform = () => (random(4294967296) + 0.5) / 4294967296;
  const gamma = (shape) => {
    const d = shape - 1 / 3,
      c = 1 / Math.sqrt(9 * d);
    for (let tries = 0; tries < 1024; tries++) {
      const z =
        Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
      const base = 1 + c * z;
      if (base <= 0) continue;
      const v = base ** 3,
        u = uniform();
      if (
        u < 1 - 0.0331 * z ** 4 ||
        Math.log(u) < (z * z) / 2 + d * (1 - v + Math.log(v))
      )
        return d * v;
    }
    throw Error("random-source-unavailable");
  };
  return (n, p) => {
    let count = 0;
    while (n > 64 && p > 0 && p < 1) {
      const a = Math.floor(n / 2) + 1,
        b = n - a + 1;
      const x = gamma(a),
        y = gamma(b),
        pivot = x / (x + y);
      if (p < pivot) {
        n = a - 1;
        p /= pivot;
      } else {
        count += a;
        n = b - 1;
        p = (p - pivot) / (1 - pivot);
      }
    }
    if (p >= 1) return count + n;
    if (p <= 0) return count;
    for (let i = 0; i < n; i++) if (uniform() < p) count++;
    return count;
  };
}
/**
 * @description Draw wins, geometrically weighted bundle sizes and independently mixed item types.
 * @param {number} attempts Number of earned independent chances.
 * @param {object} rules Validated reward settings.
 * @param {Function} sample Binomial sampler.
 * @returns {object} Successful rolls and exact awarded item counts.
 */
export function rollRewards(attempts, rules, sample = createBinomial()) {
  const successes = sample(attempts, rules.chance / 100);
  let remaining = successes,
    total = 0;
  const weights = Array.from(
    { length: rules.max - rules.min + 1 },
    (_, i) => 2 ** -i,
  );
  let weight = weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    const draws =
      i === weights.length - 1
        ? remaining
        : sample(remaining, weights[i] / weight);
    total += draws * (rules.min + i);
    remaining -= draws;
    weight -= weights[i];
  }
  const fish = sample(total, rules.fishWeight / 100),
    pat = sample(total - fish, 1 / 3),
    play = sample(total - fish - pat, 1 / 2);
  return {
    successes,
    total,
    items: { fish, pat, play, stretch: total - fish - pat - play },
  };
}
