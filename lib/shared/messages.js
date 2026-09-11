import { detailMessages } from "./locales/details.js";
import zh from "./locales/zh.js";
import en from "./locales/en.js";
import ko from "./locales/ko.js";
import ru from "./locales/ru.js";
/**
 * @description Source-keyed catalogs consumed by the shared translation layer.
 */
export const messages = {
  ...Object.fromEntries(
    Object.keys(zh).map((key) => [
      key,
      { zh: zh[key], en: en[key], ko: ko[key], ru: ru[key] },
    ]),
  ),
  ...detailMessages,
};
