import { publicText } from "../activity.js";
/**
 * @description Build stable locations for visible user/assistant messages, excluding hidden context.
 * @param {Array} events Session event snapshot.
 * @param {number} inherited Prefix belonging to another session.
 * @param {object} options Exclusive page cursor and page size.
 * @returns {object} Bounded message page and exact locations.
 */
export function messagePage(
  events,
  inherited = 0,
  { before = Infinity, limit = 30 } = {},
) {
  const messages = new Map();
  let turn = null,
    step = null,
    startSeq = null;
  for (const event of events.slice(inherited)) {
    const d = event?.data || {};
    if (event?.type === "turn/start") {
      turn = d.turn;
      startSeq = event.seq;
      step = null;
    }
    if (event?.type === "step/start") step = d.step;
    if (event?.surfaceOp === "replace") continue;
    const user =
      event?.type === "user/message" &&
      (!d.source || ["user", "human"].includes(d.source.kind));
    const assistant = event?.type === "assistant/message";
    if (!user && !assistant) continue;
    const blocks = user ? d.content : d.message?.content;
    if (!Array.isArray(blocks)) continue;
    const hasText = blocks.some(
      (block) =>
        block?.type === "text" &&
        typeof block.text === "string" &&
        block.text.trim(),
    );
    const hasAttachment = blocks.some((block) =>
      ["image", "file", "audio", "video", "attachment"].includes(block?.type),
    );
    if (!hasText && !hasAttachment) continue;
    const atTurn = d.turn ?? turn,
      atStep = d.step ?? step;
    const key =
      user && d.id != null
        ? "13:input-message" + d.id
        : assistant && atTurn != null && atStep != null
          ? "14:assistant-step" + atTurn + ":" + atStep
          : null;
    const id = key || "message:" + event.seq;
    messages.set(id, {
      id,
      key,
      role: user ? "user" : "assistant",
      blocks,
      seq: event.seq,
      turn: atTurn,
      step: atStep,
      startSeq,
      time: event.time,
    });
  }
  const all = [...messages.values()].sort((a, b) => a.seq - b.seq);
  const filtered = all.filter((message) => message.seq < before);
  const items = filtered
    .slice(-limit)
    .reverse()
    .map(({ blocks, ...message }) => ({
      ...message,
      text: publicText(blocks, 12000) || "附件消息",
    }));
  return {
    items,
    total: all.length,
    hasMore: filtered.length > items.length,
    before: items.at(-1)?.seq ?? null,
  };
}
