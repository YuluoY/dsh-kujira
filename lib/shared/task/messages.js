import { publicText } from "../activity-facts.js";
/**
 * @description Index visible messages and page their stable locations.
 * @returns {object} Incremental event consumer and page reader.
 */
export function createMessageIndex() {
  const messages = new Map(),
    ordered = [];
  let turn = null,
    step = null,
    startSeq = null;
  const append = (event) => {
    const d = event?.data || {};
    if (event?.type === "turn/start") {
      turn = d.turn;
      startSeq = event.seq;
      step = null;
    }
    if (event?.type === "step/start") step = d.step;
    if (event?.surfaceOp === "replace") return;
    const user =
      event?.type === "user/message" &&
      (!d.source || ["user", "human"].includes(d.source.kind));
    const assistant = event?.type === "assistant/message";
    if (!user && !assistant) return;
    const blocks = user ? d.content : d.message?.content;
    if (!Array.isArray(blocks)) return;
    const hasText = blocks.some(
      (block) =>
        block?.type === "text" &&
        typeof block.text === "string" &&
        block.text.trim(),
    );
    const hasAttachment = blocks.some((block) =>
      ["image", "file", "audio", "video", "attachment"].includes(block?.type),
    );
    if (!hasText && !hasAttachment) return;
    const atTurn = d.turn ?? turn,
      atStep = d.step ?? step;
    const key =
      user && d.id != null
        ? "13:input-message" + d.id
        : assistant && atTurn != null && atStep != null
          ? "14:assistant-step" + atTurn + ":" + atStep
          : null;
    const id = key || "message:" + event.seq;
    const previous = messages.get(id);
    if (previous) previous.removed = true;
    const item = {
      id,
      key,
      role: user ? "user" : "assistant",
      blocks,
      seq: event.seq,
      turn: atTurn,
      step: atStep,
      startSeq,
      time: event.time,
    };
    messages.set(id, item);
    ordered.push(item);
  };
  const page = ({ before = Infinity, limit = 30, textLimit = 12000 } = {}) => {
    let low = 0,
      high = ordered.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (ordered[middle].seq < before) low = middle + 1;
      else high = middle;
    }
    const count = Math.max(1, Math.min(30, limit));
    const items = [];
    let cursor = low - 1;
    while (cursor >= 0 && items.length < count) {
      const { blocks, removed, ...message } = ordered[cursor--];
      if (!removed)
        items.push({
          ...message,
          text: publicText(blocks, textLimit) || "附件消息",
        });
    }
    while (cursor >= 0 && ordered[cursor].removed) cursor--;
    return {
      items,
      total: messages.size,
      hasMore: cursor >= 0,
      before: items.at(-1)?.seq ?? null,
    };
  };
  return { append, page };
}
/**
 * @description Read a bounded message page from a complete event snapshot.
 * @param {Array} events Durable events.
 * @param {number} inherited Parent-owned prefix.
 * @param {object} options Cursor and page bounds.
 * @returns {object} Messages and pagination metadata.
 */
export function messagePage(events, inherited = 0, options = {}) {
  const index = createMessageIndex();
  for (let offset = inherited; offset < events.length; offset++)
    index.append(events[offset]);
  return index.page(options);
}
