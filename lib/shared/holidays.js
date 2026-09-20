import { HOLIDAY_YEARS } from "./holiday-data.js";

/**
 * @description Merge notice years in order, including December dates in the next year's notice.
 * @param {Array} years Validated annual holiday notices.
 * @returns {object} Calendar coverage and date-indexed rest days.
 */
export function holidayCalendar(years) {
  const sorted = [...years].sort((a, b) => a.year - b.year);
  return {
    source: "https://github.com/NateScarlet/holiday-cn",
    years: sorted.map((year) => year.year),
    days: Object.fromEntries(sorted.flatMap((year) => year.days.map((day) => [day.date, day.isOffDay]))),
  };
}

export const CHINA_HOLIDAYS = holidayCalendar(HOLIDAY_YEARS);
