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

`total_balance` is available credit, `topped_up_balance` is remaining paid credit, and `granted_balance` is granted credit. None is a lifetime deposit total. Country selection changes formatting, **not account currency**. Session costs are estimates from verifiable usage records and prices, not an official invoice.

Each CNY 0.10 of eligible off-peak usage estimates earns one supply; peak usage earns one per CNY 0.05. This doubles rewards for the same amount spent without changing the displayed bill. Each randomized five-drop bag contains two fish snacks and one pat, play and stretch action. Interactions share a cooldown. Free mode preserves inventory; preview usage never earns real supplies.


## Reactions and supplies

Bubbles default to 5 seconds. Hovering the mascot reveals them again; deliberate keyboard focus remains accessible. New main and child sessions trigger an eating reaction on their first execution, while historical reads do not. Both inventory modes earn supplies from settled DeepSeek usage. Unlimited interactions never consume saved stock; turning the mode off reveals the actual quantities. SVG gains appear sequentially, merging bursts of the same kind without replaying past rewards after reload.

Emergency safeguard also covers agents already running when enabled. In-flight model or tool operations are reported as waiting for a safe pause until they reach a request or step boundary. Issued operations cannot be retracted. The scheduler preserves the original continuation rather than interrupting and resubmitting a replacement task.

Button corners range from 0% (square) to 50% (circle) in settings. Hover reactions finish before returning to the current task animation; moving across several buttons keeps only the last hovered reaction. Peak rewards scatter up to 12 fish around the mascot’s feet, with additional quantities included in the reward counter. They clear automatically after a few seconds. Static and focus modes suppress the scatter animation.

Peak hours are Monday–Friday, 09:00–12:00 and 14:00–18:00 Beijing time. Weekends are entirely off-peak. Switch times are displayed in the device’s local time zone. See [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/).

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

Context reactions add occasional balance, task-duration and idle feedback. Balance bands use the API's original currency, with no conversion or high/low inference for unknown currencies. Quick completion gets a happy jump; a long task ending gets a stretch. Disable Context reactions, enable focus/static mode, or hide the page to suppress these effects. Historical completions never replay celebrations. Reactions make no model calls and do not affect charges or supplies.


### Continuous care and inclusive session costs

All four care actions keep the growth panel open. Buttons share an eight-second countdown, without queuing extra consumption. They become available automatically. Empty stock, satiety and busy-task restrictions remain visible. Network retries retain the original request ID. Growth values refresh while open; balance and weather refresh through their caches without replacing the panel.

The footer ring sits beside the session amount and uses settled supply progress from all sessions. Its progress eases forward, changing tone with each gain; a wrap completes before continuing. Bursts coalesce, while hidden and reduced-motion views update immediately. Unlimited interactions still earn supplies.

The footer total includes the current session and its recursive subagents. Peak and off-peak rows also include subagents. “Subagents included” is a subtotal already in the total. Inherited history and duplicate child references are excluded. Released children load through read-only history; unavailable records mark totals as partial. The host accounting update activates after a normal DSH restart.

Automatic price synchronization defaults to off; explicitly saved preferences remain intact. Files display a name, extension tag and opening arrow, with the original path on hover. The installed DSH already renders `.md` and `.markdown`. The plugin uses the host's viewer selection instead of registering a competing Markdown viewer or overriding another plugin or user choice.
