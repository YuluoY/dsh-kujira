import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { HOLIDAY_YEARS } from "../shared/holiday-data.js";
import { holidayCalendar } from "../shared/holidays.js";

/**
 * @description Validate published notice data; empty future-year placeholders are unavailable.
 * @param {object} value Provider or cached annual notice.
 * @param {number} year Requested notice year.
 * @returns {object} Sanitized annual holiday data.
 */
export function normalizeHolidayYear(value, year) {
  if (!Number.isInteger(year) || year < 2007 || year > 2100 || value?.year !== year ||
      !Array.isArray(value.papers) || !value.papers.length || value.papers.length > 20 ||
      !value.papers.every((url) => typeof url === "string" && /^https:\/\/www\.gov\.cn\//.test(url)) ||
      !Array.isArray(value.days) || !value.days.length || value.days.length > 100) throw Error("holiday-unpublished");
  const dates = new Set();
  const days = value.days.map((day) => {
    if (typeof day?.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
        !Number.isFinite(Date.parse(day.date)) || new Date(day.date).toISOString().slice(0, 10) !== day.date ||
        ![year - 1, year].includes(Number(day.date.slice(0, 4))) || dates.has(day.date) ||
        typeof day.isOffDay !== "boolean" || typeof day.name !== "string" || day.name.length > 80) throw Error("holiday-invalid");
    dates.add(day.date);
    return { date: day.date, name: day.name, isOffDay: day.isOffDay };
  });
  return { year, papers: value.papers, days };
}

/**
 * @description Cache annual Chinese holiday notices and retain valid data through outages.
 * @param {object} options Cache directory, network transport and clock.
 * @returns {object} Shared immutable calendar, refresh lifecycle and status.
 */
export function createHolidayCalendar({
  directory = join(homedir(), ".dsh", "dsh-kujira"),
  fetch: request = globalThis.fetch,
  now = Date.now,
  disabled = false,
} = {}) {
  const path = join(directory, "holidays.json");
  const years = new Map(HOLIDAY_YEARS.map((year) => [year.year, year]));
  let calendar = holidayCalendar([...years.values()]);
  let checkedAt = 0, retryAt = 0, busy = null, disposed = false;
  const abort = new AbortController();
  const rebuild = () => {
    const next = holidayCalendar([...years.values()]);
    if (JSON.stringify(next) !== JSON.stringify(calendar)) calendar = next;
  };
  const ready = disabled ? Promise.resolve() : readFile(path, "utf8").then((raw) => {
    if (raw.length > 250000) throw Error("holiday-cache-size");
    const saved = JSON.parse(raw);
    for (const value of saved.years || []) {
      try { years.set(value.year, normalizeHolidayYear(value, value.year)); }
      catch { /* Invalid cached years leave bundled notices intact. */ }
    }
    checkedAt = Number(saved.checkedAt) || 0;
    if (checkedAt <= now()) retryAt = checkedAt + 86400000;
    rebuild();
  }).catch(() => { /* Missing or damaged cache retains the bundled calendar. */ });
  async function loadYear(year) {
    const urls = [
      `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`,
      `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`,
    ];
    for (const url of urls) {
      try {
        const response = await request(url, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]) });
        if (!response.ok) throw Error("holiday-offline");
        const raw = await response.text();
        if (raw.length > 32000) throw Error("holiday-size");
        return normalizeHolidayYear(JSON.parse(raw), year);
      } catch { if (disposed) return null; }
    }
    return null;
  }
  async function refresh() {
    await ready;
    if (disabled || disposed) return calendar;
    if (busy) return busy;
    if (now() < retryAt) return calendar;
    busy = (async () => {
      retryAt = now() + 3600000;
      const year = new Date(now() + 8 * 3600000).getUTCFullYear();
      const notices = await Promise.all([loadYear(year), loadYear(year + 1)]);
      if (disposed) return calendar;
      for (const notice of notices) if (notice) years.set(notice.year, notice);
      rebuild();
      if (notices[0]) {
        checkedAt = now();
        retryAt = checkedAt + 86400000;
      }
      if (notices.some(Boolean)) {
        try {
          await mkdir(directory, { recursive: true });
          await writeFile(path + ".tmp", JSON.stringify({ checkedAt, years: [...years.values()] }), { mode: 0o600 });
          await rename(path + ".tmp", path);
        } catch { /* A read-only cache retains valid notices in memory. */ }
      }
      return calendar;
    })();
    try { return await busy; } finally { busy = null; }
  }
  return { ready, refresh, calendar: () => calendar, dispose() { disposed = true; abort.abort(); } };
}
