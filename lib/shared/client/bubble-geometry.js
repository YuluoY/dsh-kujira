/**
 * @description Fit a bubble and its thought trail inside the viewport while avoiding the character.
 * @param {object} anchor Character bounding rectangle.
 * @param {object} size Bubble dimensions.
 * @param {object} viewport Viewport size.
 * @param {boolean} thought Whether to reserve a dotted thought trail.
 * @returns {object} Position, facing and trail attachment.
 */
export function bubbleGeometry(anchor, size, viewport, thought = false) {
  const edge = 12,
    trail = thought ? 34 : 10;
  const width = Math.min(size.width, Math.max(1, viewport.w - edge * 2));
  const height = Math.min(
    size.height,
    Math.max(1, viewport.h - edge * 2 - trail),
  );
  const head = anchor.top + anchor.height * 0.18;
  const body = {
    left: anchor.left + anchor.width * 0.2,
    right: anchor.right - anchor.width * 0.2,
    top: head,
    bottom: anchor.bottom,
  };
  const sides = [
    { side: "left", x: anchor.left + anchor.width * 0.36 - width - 12 },
    { side: "right", x: anchor.right - anchor.width * 0.36 + 12 },
  ];
  const candidates = sides.flatMap(({ side, x }) => [
    { side, x, y: head - height - trail, below: false },
    { side, x, y: anchor.bottom + trail, below: true },
    { side, x, y: head - height * 0.35, below: false },
  ]);
  const clamp = (n, min, max) => Math.max(min, Math.min(n, Math.max(min, max)));
  for (const c of candidates) {
    c.left = clamp(c.x, edge, viewport.w - width - edge);
    c.top = clamp(
      c.y,
      edge + (c.below ? trail : 0),
      viewport.h - height - edge - (c.below ? 0 : trail),
    );
    const overlap =
      Math.max(
        0,
        Math.min(c.left + width, body.right) - Math.max(c.left, body.left),
      ) *
      Math.max(
        0,
        Math.min(c.top + height, body.bottom) - Math.max(c.top, body.top),
      );
    c.score =
      overlap * 10 +
      Math.abs(c.x - c.left) +
      Math.abs(c.y - c.top) +
      (c.below ? 20 : 0);
  }
  const best = candidates.sort((a, b) => a.score - b.score)[0];
  return {
    ...best,
    width,
    height,
    tailX: width * (best.side === "left" ? 0.78 : 0.22),
  };
}

/**
 * @description Apply shared placement and draw only the progress bubble's speech outline.
 * @param {Element} speech Bubble element.
 * @param {object} anchor Character rectangle.
 * @param {object} viewport Viewport size.
 * @param {Function} outline Existing progress outline builder.
 * @returns {void} DOM layout update.
 */
export function fitBubble(speech, anchor, viewport, outline) {
  const thought = speech.classList.contains("kj-thought-bubble");
  speech.style.maxWidth =
    Math.max(1, Math.min(244, viewport.w - 24)) + "px";
  const p = bubbleGeometry(
    anchor,
    { width: speech.offsetWidth, height: speech.offsetHeight },
    viewport,
    thought,
  );
  Object.assign(speech.style, { left: p.left + "px", top: p.top + "px" });
  speech.style.setProperty("--kj-tail-x", p.tailX + "px");
  speech.dataset.side = p.side;
  speech.dataset.below = String(p.below);
  const shell = speech.querySelector(".kj-shell");
  if (shell && outline) {
    shell.setAttribute("viewBox", `-12 -1 ${p.width + 24} ${p.height + 2}`);
    shell
      .querySelector("path")
      .setAttribute("d", outline(p.width, p.height, p.height - 16, true, true));
    shell
      .querySelector("path")
      .setAttribute(
        "transform",
        p.side === "left" ? "" : `translate(${p.width} 0) scale(-1 1)`,
      );
  }
  speech.dataset.positioned = "true";
}
