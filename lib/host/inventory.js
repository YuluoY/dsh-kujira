import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash, randomInt } from "node:crypto";
import { rateAt } from "../shared/billing.js";
import { createUsageIndex } from "./usage-index.js";
import {
  ITEM_KINDS as KINDS,
  rewardState,
  rewardRules,
  rollRewards,
  createBinomial,
} from "./inventory-rules.js";
import { PRICING } from "../shared/session-cost.js";

const GAIN = {
  fish: { satiety: 30, mood: 6, bond: 2, stat: { feeds: 1 } },
  pat: { bond: 1, mood: 2, stat: { pats: 1 } },
  play: { mood: 3, energy: -2, stat: { plays: 1 } },
  stretch: { energy: 3, stat: { stretches: 1 } },
};
const hash = (value) => createHash("sha256").update(value).digest("hex");

/**
 * @description Persist host-owned inventory with serialized writes and idempotent receipts.
 * @param {object} options Storage, pricing, clock and interaction constraints.
 * @returns {object} Inventory snapshot, reward and consumption operations.
 */
export function createInventory({
  directory = join(homedir(), ".dsh", "dsh-kujira"),
  now = Date.now,
  random = randomInt,
  getConfig = () => PRICING,
  isBusy = () => false,
  enabled = () => true,
} = {}) {
  const path = join(directory, "inventory.json"),
    startedAt = now();
  const sample = createBinomial(random);
  const readUsage = createUsageIndex(),
    observed = new WeakMap();
  let state = null,
    queue = Promise.resolve();
  const initial = () => ({
    v: 1,
    revision: 0,
    startedAt,
    free: false,
    stock: { fish: 0, pat: 0, play: 0, stretch: 0 },
    earned: { fish: 0, pat: 0, play: 0, stretch: 0 },
    credited: 0,
    ledgerStartedAt: startedAt,
    settlements: {},
    bonusStartedAt: startedAt,
    bonusCredited: 0,
    bonusSessions: {},
    peakEarned: { fish: 0, pat: 0, play: 0, stretch: 0 },
    drops: 0,
    bag: [],
    sessions: {},
    receipts: [],
    lastAction: 0,
    history: [],
  });
  async function load() {
    if (state) return;
    try {
      const value = JSON.parse(await readFile(path, "utf8"));
      if (
        value.v !== 1 ||
        !KINDS.every(
          (k) => Number.isSafeInteger(value.stock?.[k]) && value.stock[k] >= 0,
        ) ||
        !Number.isSafeInteger(value.credited) ||
        value.credited < 0 ||
        !Number.isSafeInteger(value.drops) ||
        !Array.isArray(value.bag) ||
        !value.bag.every((k) => KINDS.includes(k)) ||
        !value.sessions ||
        !Array.isArray(value.receipts) ||
        !Array.isArray(value.history) ||
        !Number.isFinite(value.startedAt)
      )
        throw Error("invalid-inventory");
      value.earned = Object.fromEntries(
        KINDS.map((kind) => [
          kind,
          Number.isSafeInteger(value.earned?.[kind]) && value.earned[kind] >= 0
            ? value.earned[kind]
            : 0,
        ]),
      );
      if (!Number.isFinite(value.bonusStartedAt)) {
        value.bonusStartedAt = now();
        value.bonusCredited = 0;
        value.bonusSessions = {};
        value.peakEarned = { fish: 0, pat: 0, play: 0, stretch: 0 };
        await save(value);
      }
      if (!Number.isFinite(value.ledgerStartedAt)) {
        value.ledgerStartedAt = startedAt;
        value.settlements = {};
        await save(value);
      }
      value.rewards = rewardState(value);
      state = value;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      state = initial();
      state.rewards = rewardState(state);
      await save(state);
    }
  }
  async function save(next) {
    await mkdir(directory, { recursive: true });
    const tmp = path + ".tmp";
    await writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
    await rename(tmp, path);
  }
  const run = (job) => {
    const promise = queue.then(async () => {
      await load();
      return job();
    });
    queue = promise.catch(() => {});
    return promise;
  };
  const view = () => ({
    ok: true,
    revision: state.revision || 0,
    cooldownMs: 0,
    rules: { ...state.rewards.rules },
    rulesRevision: state.rewards.revision,
    attempts: state.rewards.attempts,
    successes: state.rewards.successes,
    free: state.free,
    stock: { ...state.stock },
    earned: { ...state.earned },
    peakEarned: { ...state.peakEarned },
    bonusCredited: state.bonusCredited / 1e6,
    rewardMultiplier:
      state.rewards.rules.peakBonus && rateAt(now(), getConfig()) === "peak"
        ? 2
        : 1,
    credited: state.credited / 1e6,
    drops: state.drops,
    progress:
      state.rewards.carry / Math.round(state.rewards.rules.amount * 1e6),
    remaining:
      (Math.round(state.rewards.rules.amount * 1e6) - state.rewards.carry) /
      1e6 /
      (state.rewards.rules.peakBonus && rateAt(now(), getConfig()) === "peak"
        ? 2
        : 1),
    step: state.rewards.rules.amount,
    startedAt: state.startedAt,
    history: state.history.slice(-8).reverse(),
  });
  const commit = async (next) => {
    next.revision = (state.revision || 0) + 1;
    await save(next);
    state = next;
  };
  return {
    snapshot: () => run(() => view()),
    configure: (free) =>
      run(async () => {
        if (typeof free !== "boolean")
          return { ok: false, reason: "invalid-mode" };
        const next = structuredClone(state);
        next.free = free;
        await commit(next);
        return view();
      }),
    configureRules: (value, revision) =>
      run(async () => {
        const rules = rewardRules(value);
        if (!rules)
          return { ok: false, reason: "invalid-rules", inventory: view() };
        if (JSON.stringify(rules) === JSON.stringify(state.rewards.rules))
          return view();
        if (revision !== state.rewards.revision)
          return { ok: false, reason: "rules-conflict", inventory: view() };
        const next = structuredClone(state),
          old = state.rewards;
        next.rewards = {
          ...old,
          rules,
          revision: old.revision + 1,
          carry: Number(
            (BigInt(old.carry) * BigInt(Math.round(rules.amount * 1e6))) /
              BigInt(Math.round(old.rules.amount * 1e6)),
          ),
        };
        await commit(next);
        return view();
      }),
    observe: (session) =>
      run(async () => {
        if (
          !enabled() ||
          !session ||
          typeof session.snapshotEvents !== "function"
        )
          return view();
        const id = session.header?.id || session.id;
        if (!id) return view();
        const pricing = getConfig();
        if (pricing.currency !== "CNY") return view();
        const records = readUsage(session, pricing);
        const seen = observed.get(session);
        if (seen === records.version) return view();
        const candidates =
          seen === records.baseVersion ? records.changes : records.rows;
        const key = hash(String(id));
        const ledger = state.settlements[key] || {};
        const updates = {};
        let paid = 0,
          bonus = 0,
          changed = false;
        for (const row of candidates.values()) {
          if (!row.result.ok || row.ts < state.startedAt) continue;
          const recordKey = hash(row.key);
          const signature = hash(
            JSON.stringify([row.ts, row.model, row.provider, row.usage]),
          );
          const old = ledger[recordKey];
          if (old?.signature === signature) continue;
          const micro = Math.round(row.result.total * 1e6);
          if (!Number.isSafeInteger(micro) || micro < 0) continue;
          const eligible = row.ts >= state.ledgerStartedAt;
          const delta = eligible ? Math.max(0, micro - (old?.paid || 0)) : 0;
          const extra =
            row.result.rate === "peak" && row.ts >= state.bonusStartedAt
              ? delta
              : 0;
          updates[recordKey] = {
            signature,
            paid: Math.max(micro, old?.paid || 0),
          };
          paid += delta;
          bonus += extra;
          changed = true;
        }
        if (!changed) {
          observed.set(session, records.version);
          return view();
        }
        const next = {
          ...state,
          stock: { ...state.stock },
          earned: { ...state.earned },
          peakEarned: { ...state.peakEarned },
          bag: [...state.bag],
          sessions: { ...state.sessions },
          bonusSessions: { ...state.bonusSessions },
          settlements: {
            ...state.settlements,
            [key]: { ...ledger, ...updates },
          },
        };
        next.sessions[key] = (next.sessions[key] || 0) + paid;
        next.bonusSessions[key] = (next.bonusSessions[key] || 0) + bonus;
        next.credited += paid;
        next.bonusCredited += bonus;
        if (!Number.isSafeInteger(next.credited + next.bonusCredited))
          throw Error("inventory-overflow");
        const rules = state.rewards.rules;
        const step = Math.round(rules.amount * 1e6);
        const energy =
          state.rewards.carry + paid + (rules.peakBonus ? bonus : 0);
        if (!Number.isSafeInteger(energy)) throw Error("inventory-overflow");
        const attempts = Math.floor(energy / step);
        const outcome = rollRewards(attempts, rules, sample);
        const rewards = outcome.items;
        next.rewards = {
          ...state.rewards,
          carry: energy % step,
          attempts: state.rewards.attempts + attempts,
          successes: state.rewards.successes + outcome.successes,
        };
        for (const k of KINDS) {
          next.stock[k] += rewards[k];
          next.earned[k] += rewards[k];
          if (rules.peakBonus && bonus > 0) next.peakEarned[k] += rewards[k];
          if (
            !Number.isSafeInteger(next.stock[k]) ||
            !Number.isSafeInteger(next.earned[k])
          )
            throw Error("inventory-overflow");
        }
        next.drops += outcome.total;
        if (
          !Number.isSafeInteger(next.drops) ||
          !Number.isSafeInteger(next.rewards.attempts)
        )
          throw Error("inventory-overflow");
        if (outcome.total)
          next.history = [
            ...next.history,
            { time: now(), type: "reward", items: rewards, peak: rules.peakBonus && bonus > 0 },
          ].slice(-30);
        await commit(next);
        observed.set(session, records.version);
        return view();
      }),
    consume: (kind, requestId) =>
      run(async () => {
        if (
          !KINDS.includes(kind) ||
          typeof requestId !== "string" ||
          !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)
        )
          return { ok: false, reason: "invalid-action" };
        const receipt = state.receipts.find((r) => r.id === requestId);
        if (receipt)
          return receipt.kind === kind
            ? {
                ...view(),
                receiptId: requestId,
                gain: GAIN[kind],
                replayed: true,
              }
            : { ok: false, reason: "invalid-action" };
        if (!enabled()) return { ok: false, reason: "disabled" };
        if (isBusy() && kind !== "fish" && kind !== "pat")
          return { ok: false, reason: "busy" };
        if (!state.free && state.stock[kind] < 1)
          return { ok: false, reason: "empty", ...{ inventory: view() } };
        const next = structuredClone(state);
        if (!next.free) next.stock[kind]--;
        next.lastAction = now();
        next.receipts = [...next.receipts, { id: requestId, kind }].slice(-512);
        next.history = [
          ...next.history,
          { time: now(), type: "consume", kind, free: next.free },
        ].slice(-30);
        await commit(next);
        return { ...view(), receiptId: requestId, gain: GAIN[kind] };
      }),
  };
}
