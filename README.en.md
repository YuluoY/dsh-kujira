# Kujira

A desktop companion for DeepSeek Harness Web. Track agent tasks, session costs and account balances, with off-peak scheduling and pet interactions.

[简体中文](README.md) · [Releases](https://github.com/YuluoY/dsh-kujira/releases) · [Usage](docs/USAGE.en.md) · [Issues](https://github.com/YuluoY/dsh-kujira/issues)

[![Release](https://img.shields.io/github/v/release/YuluoY/dsh-kujira)](https://github.com/YuluoY/dsh-kujira/releases)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

<img src="docs/images/menu.en.png" width="355" alt="Kujira radial feature menu" />

*Isolated preview screenshots. The balance panel below uses demo amounts.*

## Installation

Requires Node.js 22.13+, pnpm and a working DeepSeek Harness Web installation, with `dsh` and `pnpm` on PATH.

Run one command from any directory on macOS, Linux or Windows:

```sh
dsh plugin --profile web add https://github.com/YuluoY/dsh-kujira/releases/download/v0.1.17/dsh-kujira-0.1.17.tgz
```

DSH downloads, installs and registers the plugin. No Git clone, manual extraction or project directory is needed. Let active sessions finish, then restart DSH Web and refresh the page. The URL pins an explicit version; use a newer release URL when upgrading.

```sh
dsh plugin --profile web remove dsh-kujira
```

For local source development, `npm run setup` remains available. See [installation, updates and removal](docs/INSTALL.md).

Installation, live balances and historical session reads were verified with DSH **0.1.5-rc.1**. Scheduling was tested through that version’s agent event dispatcher.

## Features

- **Task progress** — current operations, plans and subagents, with expandable results, files and links to their sessions.
- **Tariff scheduling** — pause main agents and subagents during peak hours and resume off-peak within the same DSH service. Off by default; enable in settings.
- **Costs and balances** — tariff status and combined parent/subagent costs at the bottom right of the composer; balances from your configured DSH DeepSeek account.
- **Pet interactions** — 130 animations for idle, work, daily routines, holidays and interactions. Continuous use has no cooldown. Configurable spending thresholds and probabilities award random bundles; unlimited mode is available.
- **Preferences** — position, size, bubble duration and menu size. Changes autosave with debouncing. Chinese, English, Korean and Russian, or follow the system.
- **Extensions** — weather, a GitHub shortcut and an [API for external menu actions](docs/EXTENSIONS.md).

<img src="docs/images/balance.en.png" width="600" alt="Balance panel beside Kujira" />

### Before you start

Scheduling takes effect at **agent step boundaries**. An issued model request or running tool finishes first. Manually cancelled tasks stay cancelled. Other independently running DSH services are outside its scope.

Balance queries reuse `DEEPSEEK_API_KEY` from DSH's credentials service. A valid official DeepSeek API key and access to the official endpoint are required; third-party relay accounts and custom credential names are not detected automatically. Credentials stay on the host and are never sent to the browser.

Weather needs no separate API key. Leave the city blank to locate by the **DSH server's outbound IP**, or enter a city to override it. Remote hosting and proxies can affect location accuracy. Domestic and international providers include failover; public services can be rate-limited or temporarily unavailable.

Country selection converts displayed amounts to CNY, USD, KRW or RUB using Frankfurter reference rates (updated daily, checked every 15 minutes). Converted amounts show ≈ and rate provenance. Outages show a dated cached rate or the original currency. Account and settlement currencies remain unchanged. Paid credit means remaining deposited funds, not lifetime deposits; session costs are usage estimates, not an official invoice.

[Scheduling and supply rules](docs/USAGE.en.md) · [Data and privacy](docs/PRIVACY.md) · [Animation triggers](docs/ANIMATIONS.md)

## Development

```bash
npm ci --legacy-peer-deps
npm run preview   # http://127.0.0.1:8792/
npm test
npm run lint
npm run typecheck
```

No frontend build is required. Host services live in `lib/host`, UI in `lib/shared/client` and `lib/shared/task`, and styles in `lib/styles`. Type checking covers annotated models and resource modules.

The preview includes task states, cost examples and long-content fixtures. Tasks and costs use isolated demo data; balance and weather panels may call real services.

## Contributing and contact

[Issues](https://github.com/YuluoY/dsh-kujira/issues) and [pull requests](https://github.com/YuluoY/dsh-kujira/pulls) are welcome: bug reports, feature ideas, documentation fixes and code improvements. For larger changes, please open an issue first.

Include your DSH version, reproduction steps and relevant screenshots in bug reports, with secrets and private content redacted. Check long text, small windows and all four languages when changing the UI.

Contact the maintainer: [@YuluoY on GitHub](https://github.com/YuluoY) · Personal blog: [uluo.cloud](https://uluo.cloud/). Please use issues for project questions.

## Contributors

<table>
  <tr>
    <td align="center" width="180">
      <a href="https://github.com/YuluoY"><img src="https://github.com/YuluoY.png?size=96" width="64" height="64" alt="YuluoY" /><br /><strong>YuluoY</strong></a><br />
      <sub>Maintenance and product design</sub>
    </td>
    <td align="center" width="180">
      <a href="https://github.com/openai"><img src="https://github.com/openai.png?size=96" width="64" height="64" alt="OpenAI" /><br /><strong>OpenAI · Codex</strong></a><br />
      <sub>AI-assisted code, tests and documentation</sub>
    </td>
  </tr>
</table>

OpenAI / Codex is credited for AI development assistance. This community plugin is maintained by YuluoY.

## Credits

- [yanzwzz/dsh-whale-girl-pet](https://github.com/yanzwzz/dsh-whale-girl-pet) — animation assets.
- [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) — reference implementation.

## Star History

[![Star History](https://api.star-history.com/svg?repos=YuluoY/dsh-kujira&type=Date)](https://www.star-history.com/#YuluoY/dsh-kujira&Date)

## License

[MIT](LICENSE). Animations retain their original copyright. Vendored [i18next](lib/shared/vendor/i18next.LICENSE) and [Marked](lib/shared/vendor/marked.LICENSE) retain their licenses.

Inventory uses transactional SQLite in a background worker (Node 22.13+). Existing JSON inventory migrates automatically and remains as a backup; do not mix older JSON writers with the new database. See [performance and migration details](docs/PERFORMANCE.md).

### Animation scenes

130 transparent clips for the same character, including 80 added animations, react to daily routines, companion needs, cached weather, holidays, task progress and pointer dwell. Search and play clips from the Companion panel. These reactions make no model requests and do not preload the full library. See [animation scenes](docs/ANIMATIONS.md). Independent eye tracking requires layered artwork; the current pointer interaction is a greeting.

Progress-on-hover is configurable. Companion speech uses a staged thought bubble. The animation picker is searchable and clearable, and only an explicit changed selection plays a clip. See [scheduler behavior and verification](docs/SCHEDULER.md) for pause/resume guarantees and the composer indicator.
