# Vendored localization runtime

`i18next.js` is the unmodified ESM distribution of **i18next 26.4.2**, obtained from the official npm package (`npm pack i18next@26.4.2`). Its MIT license is retained in `i18next.LICENSE`.

The plugin serves this module locally because DSH client plugins load plain browser modules without a build step. Localization must not depend on a third-party CDN being reachable. To update, replace the ESM distribution and license from the same pinned package, then run `npm test` and verify language switching in the preview.
