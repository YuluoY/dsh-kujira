import { pathToFileURL } from "node:url";
import { join } from "node:path";

/**
 * @description Load the same translation catalogs as the browser without importing browser services.
 */
export async function desktopTranslator(runtime, locale) {
  const language = String(locale).toLowerCase().split(/[-_]/)[0];
  const code = ["zh", "ko", "ru"].includes(language) ? language : "en";
  const [base, details] = await Promise.all([
    import(
      pathToFileURL(join(runtime, "lib/shared/locales", code + ".js")).href
    ),
    import(
      pathToFileURL(join(runtime, "lib/shared/locales", code + "-details.js"))
        .href
    ),
  ]);
  const messages = { ...base.default, ...details.default };
  return (key) => messages[key] || key;
}
