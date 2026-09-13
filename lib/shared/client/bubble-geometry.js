const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
/**
 * @description Place the cloud and both circles as one group with a small gap to the head.
 * @param {object} anchor Stable character stage.
 * @param {object} size Measured cloud.
 * @param {object} viewport Visible viewport.
 * @returns {object} Cloud position and circle coordinates relative to the cloud.
 */
function thoughtGeometry(anchor, size, viewport) {
  const edge = 12, trail = 72;
  const width = Math.min(size.width, Math.max(1, viewport.w - 24));
  const height = Math.min(size.height, Math.max(1, viewport.h - 24 - trail));
  const headTop = anchor.top + anchor.height * 0.17;
  const headBottom = anchor.top + anchor.height * 0.58;
  const face = { left: anchor.left + anchor.width * 0.24, right: anchor.right - anchor.width * 0.24, top: headTop, bottom: headBottom };
  const candidates = [];
  for (const side of ["left", "right"]) {
    const direction = side === "left" ? 1 : -1;
    const target = anchor.left + anchor.width * (side === "left" ? 0.32 : 0.68);
    const tailX = width * (side === "left" ? 0.76 : 0.24);
    const x = target - tailX - direction * 20;
    candidates.push({ side, dock: "above", x, y: headTop - height - trail, target, direction });
    candidates.push({ side, dock: "below", x, y: headBottom + trail, target, direction });
    if (viewport.w >= width + trail + edge * 2)
      candidates.push({ side, dock: "side", x: side === "left" ? face.left - width - trail : face.right + trail,
        y: (headTop + headBottom - height) / 2, target, direction });
  }
  for (const item of candidates) {
    const sideTail = item.dock === "side";
    item.left = clamp(item.x, edge + (sideTail && item.side === "right" ? trail : 0),
      viewport.w - width - edge - (sideTail && item.side === "left" ? trail : 0));
    item.top = clamp(item.y, edge + (item.dock === "below" ? trail : 0),
      viewport.h - height - edge - (item.dock === "above" ? trail : 0));
    item.tailX = clamp(item.target - item.left - item.direction * 20, Math.min(30, width / 2), Math.max(width / 2, width - 30));
    if (sideTail) {
      item.large = { x: item.side === "left" ? width + 8 : -36, y: height / 2 - 14, size: 28 };
      item.small = { x: item.side === "left" ? width + 46 : -64, y: height / 2 - 9, size: 18 };
    } else {
      item.large = { x: item.tailX - 14, y: item.dock === "above" ? height + 1 : -29, size: 28 };
      item.small = { x: item.tailX + item.direction * 20 - 9, y: item.dock === "above" ? height + 41 : -59, size: 18 };
    }
    const body = { left: item.left, right: item.left + width, top: item.top, bottom: item.top + height };
    const circles = [item.large, item.small].map(dot => ({left:item.left+dot.x,right:item.left+dot.x+dot.size,top:item.top+dot.y,bottom:item.top+dot.y+dot.size}));
    item.score = overlap(body, face) * 20 + circles.reduce((sum, circle) => sum + overlap(circle, face) * 30, 0) +
      Math.abs(item.x - item.left) + Math.abs(item.y - item.top) + (item.dock === "above" ? 0 : item.dock === "side" ? 12 : 24);
  }
  const best = candidates.sort((a, b) => a.score - b.score)[0];
  return { ...best, width, height, below: best.dock === "below" };
}

/**
 * @description Fit a bubble and its thought trail inside the viewport while avoiding the character.
 * @param {object} anchor Character bounding rectangle.
 * @param {object} size Bubble dimensions.
 * @param {object} viewport Viewport size.
 * @param {boolean} thought Whether to reserve a dotted thought trail.
 * @returns {object} Position, facing and trail attachment.
 */
export function bubbleGeometry(anchor, size, viewport, thought = false) {
  if (thought) return thoughtGeometry(anchor, size, viewport);
  const edge = 12, trail = 10;
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
  if (thought) speech.style.width = Math.max(144, Math.min(208, anchor.width * 0.74)) + "px";
  speech.style.maxWidth =
    Math.max(1, Math.min(244, viewport.w - 24, thought ? (viewport.h - 96) * 380 / 320 : Infinity)) + "px";
  const p = bubbleGeometry(
    anchor,
    { width: speech.offsetWidth, height: speech.offsetHeight },
    viewport,
    thought,
  );
  Object.assign(speech.style, { left: p.left + "px", top: p.top + "px" });
  speech.style.setProperty("--kj-tail-x", p.tailX + "px");
  if (thought) {
    speech.style.setProperty("--kj-dot-large-x", p.large.x + "px");
    speech.style.setProperty("--kj-dot-large-y", p.large.y + "px");
    speech.style.setProperty("--kj-dot-small-x", p.small.x + "px");
    speech.style.setProperty("--kj-dot-small-y", p.small.y + "px");
    speech.dataset.dock = p.dock;
  }
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
