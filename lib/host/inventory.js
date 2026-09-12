import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash, randomInt } from "node:crypto";
import { rateAt } from "../shared/billing.js";
import { createUsageIndex } from "./usage-index.js";
import { PRICING } from "../shared/session-cost.js";

const STEP = 100000; // CNY micro-units: 0.10 yuan per drop.
const KINDS = ["fish", "pat", "play", "stretch"];
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
      state = value;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      state = initial();
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
    free: state.free,
    stock: { ...state.stock },
    earned: { ...state.earned },
    peakEarned: { ...state.peakEarned },
    bonusCredited: state.bonusCredited / 1e6,
    rewardMultiplier: rateAt(now(), getConfig()) === "peak" ? 2 : 1,
    credited: state.credited / 1e6,
    drops: state.drops,
    progress: ((state.credited + state.bonusCredited) % STEP) / STEP,
    remaining:
      (STEP - ((state.credited + state.bonusCredited) % STEP)) /
      1e6 /
      (rateAt(now(), getConfig()) === "peak" ? 2 : 1),
    step: STEP / 1e6,
    startedAt: state.startedAt,
    history: state.history.slice(-8).reverse(),
  });
  const commit = async (next) => {
    next.revision = (state.revision || 0) + 1;
    await save(next);
    state = next;
  };
  function draw(next) {
    if (!next.bag.length) {
      next.bag = ["fish", "fish", "pat", "play", "stretch"];
      for (let i = next.bag.length - 1; i > 0; i--) {
        const j = random(i + 1);
        [next.bag[i], next.bag[j]] = [next.bag[j], next.bag[i]];
      }
    }
    return next.bag.pop();
  }
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
        const due =
          Math.floor((next.credited + next.bonusCredited) / STEP) - next.drops;
        const rewards = { fish: 0, pat: 0, play: 0, stretch: 0 };
        // Whole shuffled bags have fixed contents, avoiding an unbounded loop for large usage.
        let remaining = due;
        while (remaining > 0 && next.bag.length) {
          rewards[draw(next)]++;
          remaining--;
        }
        const bags = Math.floor(remaining / 5);
        rewards.fish += bags * 2;
        for (const k of ["pat", "play", "stretch"]) rewards[k] += bags;
        remaining %= 5;
        while (remaining-- > 0) rewards[draw(next)]++;
        for (const k of KINDS) {
          next.stock[k] += rewards[k];
          next.earned[k] += rewards[k];
          if (bonus > 0) next.peakEarned[k] += rewards[k];
          if (
            !Number.isSafeInteger(next.stock[k]) ||
            !Number.isSafeInteger(next.earned[k])
          )
            throw Error("inventory-overflow");
        }
        next.drops += due;
        if (due)
          next.history = [
            ...next.history,
            { time: now(), type: "reward", items: rewards, peak: bonus > 0 },
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
        if (now() - state.lastAction < 8000)
          return { ok: false, reason: "cooldown" };
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
