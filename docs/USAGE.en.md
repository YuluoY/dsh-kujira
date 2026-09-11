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
