// Bounded public task facts. Never read reasoning blocks, raw streams or hidden prompts.
/**
 * @description Bound and redact public text, detaching short excerpts from large source strings.
 * @param {unknown} value Source value.
 * @param {number} limit Maximum visible characters.
 * @returns {string} Public excerpt.
 */
export function cleanText(value, limit = 240) {
  if (typeof value !== "string") return "";
  const text = value.slice(0, Math.max(4096, limit * 4 + 1024))
    .replace(/\b(?:sk-[\w-]{12,}|Bearer\s+\S+)/gi, "[redacted]")
    .replaceAll(String.fromCharCode(0), "").trim().slice(0, limit).replace(/[\uD800-\uDBFF]$/, "");
  return value.length > text.length * 4 ? JSON.parse(JSON.stringify(text)) : text;
}
/**
 * @description Extract visible text blocks within a bounded input budget.
 * @param {Array} blocks Message content blocks.
 * @param {number} limit Maximum visible characters.
 * @returns {string} Public excerpt without reasoning blocks.
 */
export function publicText(blocks, limit = 240) {
  if (!Array.isArray(blocks)) return "";
  const budget = Math.max(4096, limit * 4 + 1024);
  let text = "";
  for (const block of blocks) {
    if (block?.type !== "text" || typeof block.text !== "string") continue;
    if (text) text += "\n";
    text += block.text.slice(0, budget - text.length);
    if (text.length >= budget) break;
  }
  return cleanText(text, limit);
}
export const parsed = (value) => {
  try {
    const data = typeof value === "string" ? JSON.parse(value) : value;
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
};
export const location = (e) => ({
  seq: Number.isSafeInteger(e.seq) ? e.seq : null,
  turn: e.data?.turn ?? null,
  step: e.data?.step ?? null,
});
export function operationKind(name, args = {}) {
  if (name === "str_replace_editor" && args.command === "view")
    return "reading";
  if (/question/.test(name)) return "waiting";
  if (/subagent|delegate|spawn_agent/.test(name)) return "delegating";
  if (/search|grep|glob|find|fetch/.test(name)) return "searching";
  if (/read|view/.test(name)) return "reading";
  if (!/todo/.test(name) && /write|edit|patch/.test(name)) return "editing";
  if (/exec|bash|shell|run/.test(name))
    return /(?:^|\s)(?:test|pytest|vitest|jest|tsc|lint)|npm test|pnpm test/.test(
      String(args.command || args.cmd || ""),
    )
      ? "testing"
      : "working";
  return "working";
}
export const phaseLabel = {
  idle: "准备好了",
  paused: "峰价暂停",
  thinking: "正在梳理任务",
  reading: "正在阅读资料",
  searching: "正在检索信息",
  editing: "正在修改文件",
  testing: "正在验证结果",
  delegating: "正在分配子任务",
  working: "正在执行任务",
  summarizing: "正在整理结果",
  waiting: "需要你回应",
  retrying: "正在重试",
  done: "本轮已完成",
  error: "遇到问题",
  stopped: "本轮已停止",
};
