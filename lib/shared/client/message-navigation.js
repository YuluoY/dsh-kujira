/**
 * @description Locate one exact DSH chat node after loading its containing history.
 * @param {object} target Durable message coordinates.
 * @param {object} options Public session service and stale-session guard.
 * @returns {Promise<boolean>} Whether the exact message was revealed.
 */
export async function revealMessage(
  target,
  { sessions, isCurrent, document: doc = document },
) {
  if (!isCurrent() || !target.key) return false;
  const find = () =>
    [...doc.querySelectorAll("[data-chat-anchor-key]")].find(
      (node) => node.dataset.chatAnchorKey === target.key,
    );
  const findNav = () =>
    [...doc.querySelectorAll("nav button[aria-label]")].find((button) => {
      const label = button.getAttribute("aria-label") || "";
      const match = label.match(
        /(?:第\s*(\d+)\s*轮|(?:jump to turn|load and jump to turn)\s+(\d+))/i,
      );
      return match && Number(match[1] || match[2]) === target.turn;
    });
  let node = find();
  if (!node) {
    const session = sessions?.binding?.(target.sessionId)?.session;
    if (!session?.loadThrough) return false;
    let timeout;
    try {
      await Promise.race([
        session.loadThrough(target.startSeq ?? target.seq),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(Error("Message loading timed out")),
            15000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    if (!isCurrent()) return false;
    for (let i = 0; i < 30 && !node; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (!isCurrent()) return false;
      node = find();
    }
  }
  if (!node || !isCurrent()) return false;
  findNav()?.click();
  if (node.dataset.turnProcessHidden === "true") {
    const control = [...doc.querySelectorAll("[data-turn-process]")].find(
      (el) => el.dataset.turnProcess === String(target.turn),
    );
    const button = control?.matches('button[aria-expanded="false"]')
      ? control
      : control?.querySelector('button[aria-expanded="false"]');
    button?.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    node = find();
  }
  if (!node || !isCurrent() || node.hidden || !node.getClientRects().length)
    return false;
  node.scrollIntoView({
    block: "center",
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
  });
  node.setAttribute("tabindex", "-1");
  node.focus({ preventScroll: true });
  node.animate?.(
    [
      { backgroundColor: "rgba(132,151,175,.2)" },
      { backgroundColor: "transparent" },
    ],
    {
      duration: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 1100,
    },
  );
  return true;
}
