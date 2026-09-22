# Usage

[简体中文](USAGE.md) · [English](USAGE.en.md)

### Global peak/off-peak scheduling

Enable **Settings → Global session schedule → Emergency safeguard**. It is off by default and persists on the host.

| Event | Behavior |
|---|---|
| Peak tariff | Global `agent/pre-step` and `agent/request` gates blocks the next step for main agents and subagents. |
| Off-peak tariff | Release each waiting original continuation. No synthetic “continue” prompt is submitted. |
| Manual cancellation | Cancelled work stays cancelled; off-peak scheduling does not resurrect it. |
| Disable scheduling | Immediately release scheduler-held steps. |

An already-issued model request or running tool finishes before the pause. This does not retract requests or reverse charges. The scope is **one DSH service process**, not independent installations on other machines. The active pricing configuration and its time zone define tariff boundaries; UI language does not.

Local preview has no real DSH agents and is labelled accordingly. The installed host uses real lifecycle hooks. Unsupported host capabilities display an unavailable state instead of reporting a false success.

### Amounts and inventory

`total_balance` is available credit, `topped_up_balance` is remaining paid credit, and `granted_balance` is granted credit. None is a lifetime deposit total. Display currency is independent of interface language and weather service region. It defaults to the original currency; selecting CNY, USD, KRW or RUB converts displayed amounts at reference rates. Account balances and settlement data remain in their original currencies. Session costs are estimates from verifiable usage records and prices, not an official invoice.

By default, each CNY 0.10 of eligible usage earns a roll with a 25% chance of 1–3 items. Smaller bundles are more common. Peak bonus doubles roll progress without changing the bill. Items have no time cooldown. Unlimited mode preserves stock and still earns random drops; preview usage never awards real inventory.


## Reactions and supplies

Bubbles default to 5 seconds. Hovering the mascot reveals them again; deliberate keyboard focus remains accessible. New main and child sessions trigger an eating reaction on their first execution, while historical reads do not. Both inventory modes earn supplies from settled DeepSeek usage. Unlimited interactions never consume saved stock; turning the mode off reveals the actual quantities. SVG gains appear sequentially, merging bursts of the same kind without replaying past rewards after reload.

Emergency safeguard also covers agents already running when enabled. In-flight model or tool operations are reported as waiting for a safe pause until they reach a request or step boundary. Issued operations cannot be retracted. The scheduler preserves the original continuation rather than interrupting and resubmitting a replacement task.

Button corners range from 0% (square) to 50% (circle) in settings. Hover reactions finish before returning to the current task animation; moving across several buttons keeps only the last hovered reaction. Peak rewards scatter up to 12 fish around the mascot’s feet, with additional quantities included in the reward counter. They clear automatically after a few seconds. Static and focus modes suppress the scatter animation.

Official API peak hours worldwide are Monday–Friday, 09:00–12:00 and 14:00–18:00 Beijing time, excluding Chinese public holidays. Weekends, including makeup workdays, and Chinese public holidays are entirely off-peak. Switch times are displayed in the device’s local time zone. See [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/).

## Task overview and accounting

The task panel shows status, goal, plan and outcome. Child tasks needing attention come first; files and tool records stay collapsed until needed. Results render as Markdown. File and child-session links appear only when supported by the host. Imprecise step-location links have been removed.

Supplies accrue from unique settled usage records. Pausing, refreshing, duplicate events, tariff-clock transitions and historical repricing do not generate rewards. Real usage delivered after cancellation still settles, and other running sessions or subagents can keep earning. Pending reward animations clear when no agents remain active; inventory is preserved. Upgrades do not reissue historical rewards.

## Session-cost display

Set “Cost decimal places” under Settings → Usage & privacy. Choose 0–6 places; the default is 4. The dock and breakdown share this precision without changing accounting or supply rewards. Only changed digits roll vertically. Initial loading, session changes, locale changes and precision changes display immediately; reduced-motion and focus modes stay static. The breakdown leads with the total, followed by off-peak and peak costs. Hovering the dock shows only the next tariff switch.

## Task detail tabs

The task overview stays visible above Team, Plan, Files and Activity tabs. Empty categories are omitted. Each category keeps its scroll position and expanded list length; arrow keys and Home/End switch tabs. Results remain available inside the panel.

The default plugin makes no extra model calls, but it uses local resources. See [performance and measurement notes](PERFORMANCE.md).

Task categories have explicit scopes: Team includes children still running or awaiting input across turns, plus children started or finished during this turn. Plan retains this session's latest `todo/write`; a new list, including an empty list, replaces it. Earlier plans are labeled “Latest plan”. Files keeps the 20 most recently verified changed files in the session; Activity shows this turn's tool operations. Inherited events from another session are excluded.

PTC activity reads `tool/ptc-dispatch-start` and `tool/ptc-dispatch`, showing operations inside `run_code` while preserving outer errors. File changes require successful `write`, `edit`, `write_file`, `edit_file`, or a mutating `str_replace_editor` operation. Reads, failures, unknown tools and Bash output do not establish file changes. Empty categories stay hidden.

File labels are relative to the session working directory; external paths remain explicit and navigation uses the original path. Plan items and file paths use one-line limits; message previews use two-line limits, with full text available on hover or keyboard focus and scrollable long tooltips. Loading icons express active work without repeating a visible running label.

The latest public message links to its original position. Chat provides an index of 30 messages per page, with older history loaded on demand. Navigation uses exact message identities and durable event positions, loads host history when needed, and cancels subsequent navigation when the session changes or the panel closes. Missing host capabilities produce a notice rather than an approximate text match.

The Plan tab shows completed/total from actual `todo/write` data, excluding cancelled items from the total. There is no separate progress-bar row. Open panels refresh about every 1.5 seconds; hidden pages suspend polling. Updates retain the selected category, loaded message pages and per-category scroll positions.

Opening a child from the task panel keeps the panel open. Its back button returns to the parent and restores the prior category and browsing position. After a message jump, reopen the task panel to return to the previous reading position. Missing anchors produce a notice rather than an approximate jump. Return history belongs to the current page; unrelated session selections do not reuse stale routes.

### Task shortcut, long text and greetings

The feature menu includes a Task progress shortcut, enabled by default. Hide it under Feature menu → Task shortcut. It respects the saved button limit and moves into More when necessary. The mascot's hover status bubble remains available.

A single category uses a small heading; multiple categories use tabs. Paths and plan items fill the available width before a one-line ellipsis; messages keep two lines. Full-text tooltips appear only for actual clipping and are remeasured after container, font-size or font-loading changes. Lists expand on demand and Chat loads 30 messages per page.

Set a preferred name under Companion & motion → Name. This overrides the account name of the system running DSH. Missing or generic service accounts fall back to an affectionate localized nickname (“sweetie” in English); Git authors are not consulted. Remote installations see the server account, so a custom name is recommended there. Names stay in the local UI and are never sent to the model. The limit is 24 graphemes.

Context reactions add occasional balance, task-duration and idle feedback. Balance bands use the API's original currency independently of converted display values, without high/low inference for unknown currencies. Quick completion gets a happy jump; a long task ending gets a stretch. Disable Context reactions, enable focus/static mode, or hide the page to suppress these effects. Historical completions never replay celebrations. Reactions make no model calls and do not affect charges or supplies.


### Continuous care and inclusive session costs

All four care actions keep the growth panel open. There is no time cooldown or wait for animation completion. Clicks are processed in order; feeding remains possible at full satiety. Empty stock, busy-task restrictions and network failures stop unsent actions. Network retries retain the original request ID. Growth values refresh while open; balance and weather refresh through their caches without replacing the panel.

The footer ring sits beside the session amount and uses settled supply progress from all sessions. Its progress eases forward, changing tone with each gain; a wrap completes before continuing. Bursts coalesce, while hidden and reduced-motion views update immediately. Unlimited interactions still earn supplies.

The footer total includes the current session and its recursive subagents. Peak and off-peak rows also include subagents. “Subagents included” is a subtotal already in the total. Inherited history and duplicate child references are excluded. Released children load through read-only history; unavailable records mark totals as partial. The host accounting update activates after a normal DSH restart.

Automatic price synchronization defaults to off; explicitly saved preferences remain intact. Files display a name, extension tag and opening arrow, with the original path on hover. The installed DSH already renders `.md` and `.markdown`. The plugin uses the host's viewer selection instead of registering a competing Markdown viewer or overriding another plugin or user choice.


### Random-drop settings

Settings → Random drops provides spend per roll (CNY 0.01–100; default 0.10), success probability (0–100%; default 25%), minimum and maximum items (1–20; default 1–3), fish share (0–100%; default 50%), and peak bonus (on by default). Edits show immediately and autosave about 400 ms after the last adjustment. Inputs stay editable while saving; late replies preserve newer edits. Invalid ranges and failures are shown with an error-only retry action.

Rolls are independent and may miss, without a guaranteed fallback. A success first chooses bundle size, then draws each item type independently. Within the size range, each additional item halves its relative weight. Changing rules preserves fractional progress and stock, applies to future settlements, and never rerolls past spending. Conflicting edits from another window require reviewing the latest settings. The ring tracks the next chance rather than a guaranteed reward.

Continuous use has no timed restriction. Requests serialize with up to 20 pending clicks; failures cancel unsent clicks and retries retain the original request ID. Animation playback coalesces repeated actions into at most one pending reaction.

Confirmed appearance, language, currency and menu-size edits persist immediately. The same browser site restores settings, weather city, growth and position. Desktop mode also backs up this data in desktop.json in its application user-data directory, restoring the newer record before showing the mascot. Each handoff snapshot is applied only once; browser and native desktop positions stay independent. Settings use a consistent control column with units inside numeric inputs. See [installation](INSTALL.md) and [data handling](PRIVACY.md).


### Appearance

Theme defaults to **Auto**, matching the current DSH appearance and updating when it changes. Choose Light or Dark to override it for Kujira. Language and reduced-motion settings remain independent.

## Exchange rates

[Frankfurter v2](https://frankfurter.dev/) supplies daily reference rates without an API key. The host coalesces requests and caches rates for 15 minutes, with a 5-second timeout and 60-second failure backoff. Hidden pages stop refreshing. Converted amounts show ≈; balance and cost details show source and publication date. Rates older than 7 days are rejected. On outages, a dated cache is labeled or the original currency is shown. No model calls or account data are sent to this service.

Budget and reward-threshold inputs remain explicitly labeled CNY with an approximate local equivalent; changing display currency never rewrites settlement rules. Set `exchangeRates.enabled: false` in the host plugin configuration to disable requests. Offline previews disable rates by default; `PREVIEW_EXCHANGE=1` enables rate-only network testing without loading account credentials.

### Chinese holiday calendar

The plugin bundles 2025 and 2026 notices from [holiday-cn](https://github.com/NateScarlet/holiday-cn) (MIT). The host refreshes the current and next notice years daily, with a one-hour retry interval on failure and five-second request timeouts. Next-year notices also apply to December dates. Valid data is cached in `~/.dsh/dsh-kujira/holidays.json` (or the configured inventory/holidayCalendar directory). Outages and empty future-year placeholders retain valid data. If the current year is unavailable, weekday hours apply provisionally and scheduler settings show a warning. `holidayCalendar.enabled: false` disables network updates while preserving bundled dates; previews disable updates. Language and currency never affect tariff timing.

## DeepSeek Harness updates

Settings → Services → DeepSeek Harness updates checks the official npm registry daily by default. A dot on Settings indicates a newer version. Automatic checks can be disabled; manual checks are limited to once per minute, and failures retry hourly while retaining the last result. No model calls are involved.

The default channel follows alpha installations, otherwise latest; both channels also consider a newer latest release. Automatic updates never downgrade. The Version history & rollback disclosure lists official non-deprecated releases for an explicit version switch, including older releases. Previous installed versions are remembered. Rollback retains sessions and configuration; older releases may not support newer configuration. It identifies the running npm/pnpm global installation, pins the displayed official `@deepseek-ai/dsh` version, enforces package engine requirements and verifies the installed version. Source checkouts, temporary npx runs and unknown layouts remain read-only. Installation requires a local browser request and no running tasks. No sudo, account changes, plugin changes or session deletion are performed.

Installation has a ten-minute timeout and a per-user process lock. Exiting DSH cancels the installer. After success, restart DSH normally to run the installed version; the current running version stays visible until then. Settings persist in `harness-update.json` in the plugin data directory. `harnessUpdate.enabled: false` disables this service. `PREVIEW_UPDATE=1` enables read-only version checks in previews; previews can never install updates.
