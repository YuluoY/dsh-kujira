# Usage

[简体中文](USAGE.md) · [English](USAGE.en.md)

### Global peak/off-peak scheduling

Enable **Settings → Global session schedule → Run off-peak**. It is off by default and persists on the host.

| Event | Behavior |
|---|---|
| Peak tariff | Global `agent/pre-step` gate blocks the next step for main agents and subagents. |
| Off-peak tariff | Release each waiting original continuation. No synthetic “continue” prompt is submitted. |
| Manual cancellation | Cancelled work stays cancelled; off-peak scheduling does not resurrect it. |
| Disable scheduling | Immediately release scheduler-held steps. |

An already-issued model request or running tool finishes before the pause. This does not retract requests or reverse charges. The scope is **one DSH service process**, not independent installations on other machines. The active pricing configuration and its time zone define tariff boundaries; UI language does not.

Local preview has no real DSH agents and is labelled accordingly. The installed host uses real lifecycle hooks. Unsupported host capabilities display an unavailable state instead of reporting a false success.

### Amounts and inventory

`total_balance` is available credit, `topped_up_balance` is remaining paid credit, and `granted_balance` is granted credit. None is a lifetime deposit total. Country selection changes formatting, **not account currency**. Session costs are estimates from verifiable usage records and prices, not an official invoice.

By default, every CNY 0.10 of eligible usage estimates earns one supply. Each randomized five-drop bag contains two fish snacks and one pat, play and stretch action. Interactions share a cooldown. Free mode preserves inventory; preview usage never earns real supplies.

