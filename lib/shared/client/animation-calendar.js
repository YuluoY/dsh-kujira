let lunarFormatter;
let cachedDay = "",
  cached = null;
const lunarScenes = {
  "1-1": "springFestival",
  "1-15": "lantern",
  "5-5": "dragonBoat",
  "7-7": "qixi",
  "7-15": "riverLantern",
  "8-15": "midAutumn",
  "9-9": "doubleNinth",
  "12-8": "laba",
};

/**
 * @description Resolve local calendar occasions, with an optional Chinese lunar calendar.
 * @param {Date} date Local browser date.
 * @returns {{festival: string|null, season: string}} Scene identifiers.
 */
export function calendarScenes(date) {
  const day = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  if (day === cachedDay) return cached;
  const month = date.getMonth() + 1;
  let festival =
    {
      "1-1": "newYear",
      "10-31": "halloween",
      "12-24": "christmas",
      "12-25": "christmas",
    }[`${month}-${date.getDate()}`] || null;
  try {
    lunarFormatter ||= new Intl.DateTimeFormat("en-u-ca-chinese", {
      month: "numeric",
      day: "numeric",
    });
    if (!festival && lunarFormatter.resolvedOptions().calendar === "chinese") {
      const parts = Object.fromEntries(
        lunarFormatter.formatToParts(date).map((p) => [p.type, p.value]),
      );
      festival = lunarScenes[`${parts.month}-${parts.day}`] || null;
    }
  } catch {}
  cachedDay = day;
  cached = {
    festival,
    season:
      month >= 3 && month <= 5
        ? "spring"
        : month >= 6 && month <= 8
          ? "summer"
          : month >= 9 && month <= 11
            ? "autumn"
            : "winter",
  };
  return cached;
}
