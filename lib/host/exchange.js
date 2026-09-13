import { EXCHANGE_CURRENCIES, EXCHANGE_MAX_AGE } from "../shared/exchange.js";
const URL = "https://api.frankfurter.dev/v2/rates?base=CNY&quotes=USD,KRW,RUB";
const TTL = 15 * 60000, RETRY = 60000;
/**
 * @description Validate the complete small currency table and reject stale or malformed provider data.
 * @param {unknown} rows Provider JSON.
 * @param {number} now Current host time.
 * @returns {object} Sanitized rates with per-currency publication dates.
 */
export function normalizeExchange(rows, now) {
  if (!Array.isArray(rows) || rows.length !== 3) throw Error("invalid-rates");
  const rates = { CNY: 1 }, dates = {};
  for (const row of rows) {
    const stamp = Date.parse(row?.date);
    if (row?.base !== "CNY" || row.quote === "CNY" || !EXCHANGE_CURRENCIES.includes(row.quote) ||
        rates[row.quote] !== undefined || typeof row.rate !== "number" ||
        !Number.isFinite(row.rate) || row.rate <= 0 || row.rate > 1e8 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(stamp) ||
        new Date(stamp).toISOString().slice(0, 10) !== row.date ||
        stamp > now + 86400000 || now - stamp > EXCHANGE_MAX_AGE) throw Error("invalid-rates");
    rates[row.quote] = row.rate;
    dates[row.quote] = row.date;
  }
  return { ok: true, base: "CNY", rates, dates, fetchedAt: now,
    source: "Frankfurter", sourceUrl: "https://frankfurter.dev/", frequency: "daily", stale: false };
}
/**
 * @description Fetch public reference rates lazily with single-flight, bounded timeout and outage backoff.
 * @param {object} options Injectable network, clock and disabled mode.
 * @returns {object} Query and disposal; no agent hook or background interval.
 */
export function createExchangeClient({ fetch: request = globalThis.fetch, now = Date.now, disabled = false } = {}) {
  let cache = null, pending = null, nextTry = 0, disposed = false, controller;
  const fallback = () => cache && now() >= cache.fetchedAt &&
    Object.values(cache.dates).every((date) => now() - Date.parse(date) <= EXCHANGE_MAX_AGE)
    ? { ...cache, stale: true }
    : { ok: false, reason: disabled ? "disabled" : "exchange-unavailable" };
  async function read() {
    controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await request(URL, { headers: { Accept: "application/json" }, signal: controller.signal });
      if (!response.ok) throw Error("exchange-http");
      const reader = response.body.getReader();
      let size = 0, body = "";
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 16384) { await reader.cancel(); throw Error("exchange-size"); }
          body += decoder.decode(value, { stream: true });
        }
      } finally { reader.releaseLock(); }
      body += decoder.decode();
      const result = normalizeExchange(JSON.parse(body), now());
      if (disposed) return { ok: false, reason: "disposed" };
      cache = result;
      nextTry = now() + TTL;
      return result;
    } catch {
      nextTry = now() + RETRY;
      return fallback();
    } finally { clearTimeout(timer); }
  }
  return {
    query() {
      if (disposed || disabled) return Promise.resolve({ ok: false, reason: disabled ? "disabled" : "disposed" });
      if (pending) return pending;
      if (cache && now() >= cache.fetchedAt && now() - cache.fetchedAt < TTL) return Promise.resolve(cache);
      if (now() < nextTry && (!cache || now() >= cache.fetchedAt)) return Promise.resolve(fallback());
      pending = read().finally(() => { pending = null; });
      return pending;
    },
    dispose() { disposed = true; controller?.abort(); },
  };
}
