# Kujira

A desktop companion for DeepSeek Harness Web. Track agent tasks, session costs and account balances, with off-peak scheduling and pet interactions.

[简体中文](README.md) · [Releases](https://github.com/YuluoY/dsh-kujira/releases) · [Usage](docs/USAGE.en.md) · [Issues](https://github.com/YuluoY/dsh-kujira/issues)

[![Release](https://img.shields.io/github/v/release/YuluoY/dsh-kujira)](https://github.com/YuluoY/dsh-kujira/releases)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

<img src="docs/images/task-progress.png" width="560" alt="Kujira and the task progress panel" />

*Cropped screenshot with demo task data.*

## Installation

Requires Node.js 22+ and a working DeepSeek Harness Web installation.

```bash
git clone https://github.com/YuluoY/dsh-kujira.git
cd dsh-kujira
npm run link
```

Restart DSH Web and refresh the page. Alternatively, extract a [release archive](https://github.com/YuluoY/dsh-kujira/releases) and run `npm run link` from its directory. Keep the directory: the installation links to it.

```bash
npm run unlink   # Restart DSH Web after removing the plugin
```

Installation, live balances and historical session reads were verified with DSH **0.1.5-rc.1**. Scheduling was tested through that version’s agent event dispatcher.

## Features

- **Task progress** — current operations, plans and subagents, with expandable results, files and links to their sessions.
- **Tariff scheduling** — pause main agents and subagents during peak hours and resume off-peak within the same DSH service. Off by default; enable in settings.
- **Costs and balances** — tariff status and session costs at the bottom right of the composer; balances from your configured DSH DeepSeek account.
- **Pet interactions** — 50 animations for idle, work, sleep and interactions. DeepSeek usage earns random supplies; free interaction is also available.
- **Preferences** — position, size, bubble duration and menu size. Chinese, English, Korean and Russian, or follow the system.
- **Extensions** — weather, a GitHub shortcut and an [API for external menu actions](docs/EXTENSIONS.md).

<img src="docs/images/session-cost.png" width="248" alt="Off-peak, peak and total session costs" />

### Before you start

Scheduling takes effect at **agent step boundaries**. An issued model request or running tool finishes first. Manually cancelled tasks stay cancelled. Other independently running DSH services are outside its scope.

Amounts retain the currency returned by DeepSeek. Language selection does not convert currencies. Paid credit means remaining deposited funds, not lifetime deposits; session costs are usage estimates, not an official invoice.

[Scheduling and supply rules](docs/USAGE.en.md) · [Animation triggers](docs/ANIMATIONS.md)

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

For bug reports, include your DSH version, reproduction steps and relevant screenshots. Check long text, small windows and all four languages when changing the UI. Open an issue to discuss larger contributions.

## Contributors and credits

- [YuluoY](https://github.com/YuluoY) — maintenance and product design.
- [OpenAI](https://openai.com/) · Codex — AI-assisted implementation, refactoring, testing and documentation.
- [yanzwzz/dsh-whale-girl-pet](https://github.com/yanzwzz/dsh-whale-girl-pet) — animation assets.
- [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) — reference implementation.

This is a community plugin. The OpenAI credit acknowledges Codex development assistance; it does not imply official maintenance, partnership or endorsement by OpenAI or DeepSeek.

## Star History

[![Star History](https://api.star-history.com/svg?repos=YuluoY/dsh-kujira&type=Date)](https://www.star-history.com/#YuluoY/dsh-kujira&Date)

## License

[MIT](LICENSE). Animations retain their original copyright. Vendored i18next retains its [third-party license](lib/shared/vendor/i18next.LICENSE).
