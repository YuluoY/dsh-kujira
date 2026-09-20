export const EXCHANGE_MAX_AGE = 7 * 86400000;
export const EXCHANGE_CURRENCIES = ["CNY", "USD", "KRW", "RUB"];
let snapshot = null;
let displayCurrency = "original";
const listeners = new Set();
export const exchangeSnapshot = () => snapshot;
/**
 * @description Set the display currency independently of the interface language.
 * @param {string} currency ISO currency or original.
 * @returns {void}
 */
export function configureCurrency(currency) {
  displayCurrency = EXCHANGE_CURRENCIES.includes(currency) ? currency : "original";
}
export function publishExchange(value) {
  snapshot = value;
  for (const listener of listeners) listener(value);
}
export function subscribeExchange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
/**
 * @description Convert presentation values only; unavailable rates preserve the source currency.
 * @param {number} value Original amount, never mutated or persisted here.
 * @param {string} source ISO account or billing currency.
 * @param {string} target Selected currency or original.
 * @param {object} rates Latest host snapshot.
 * @param {number} now Clock for bounded stale-rate acceptance.
 * @returns {object} Amount, currency and conversion provenance.
 */
export function exchangeAmount(value, source, target = displayCurrency, rates = snapshot, now = Date.now()) {
  if (!EXCHANGE_CURRENCIES.includes(target)) target = source;
  const original = { value, currency: source, converted: false, unavailable: source !== target };
  if (source === target) return original;
  const valid = (currency) => currency === "CNY" || (
    Number.isFinite(rates?.rates?.[currency]) && rates.rates[currency] > 0 &&
    Number.isFinite(Date.parse(rates?.dates?.[currency])) &&
    now - Date.parse(rates.dates[currency]) <= EXCHANGE_MAX_AGE &&
    Date.parse(rates.dates[currency]) <= now + 86400000
  );
  if (!Number.isFinite(value) || !rates?.ok || !valid(source) || !valid(target)) return original;
  const from = source === "CNY" ? 1 : rates.rates[source];
  const to = target === "CNY" ? 1 : rates.rates[target];
  const converted = value * to / from;
  if (!Number.isFinite(converted)) return original;
  return { value: converted, currency: target, converted: true, unavailable: false,
    stale: !!rates.stale, date: [rates.dates[source], rates.dates[target]].filter(Boolean).sort()[0] };
}
