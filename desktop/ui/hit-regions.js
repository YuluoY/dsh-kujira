/**
 * @description Bound the opening path or the settled hit area of one radial button.
 */
export function orbHitRegion(host, size, dx, dy, moving) {
  const cx = host.x + host.width / 2 + dx;
  const cy = host.y + host.height / 2 + dy;
  const startX = moving ? host.x + host.width / 2 : cx;
  const startY = moving ? host.y + host.height / 2 : cy;
  const padding = size / 2 + 8;
  return {
    x: Math.min(startX, cx) - padding,
    y: Math.min(startY, cy) - padding,
    width: Math.abs(cx - startX) + padding * 2,
    height: Math.abs(cy - startY) + padding * 2,
  };
}

/**
 * @description Sample an interactive surface, including the transparent first frame of its entrance.
 * @param {HTMLElement} el Interactive surface element.
 * @param {CSSStyleDeclaration} style Current computed appearance.
 * @returns {object} Current hit rectangle and finite-motion status.
 */
export function surfaceHitRegion(el, style) {
  const moving = el.getAnimations().some((animation) => {
    const active = animation.pending || animation.playState === "running";
    return (
      active && Number.isFinite(animation.effect?.getComputedTiming().endTime)
    );
  });
  const r = el.getBoundingClientRect();
  const visible =
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.visibility !== "collapse" &&
    (Number(style.opacity) > 0 || moving) &&
    r.width > 0 &&
    r.height > 0;
  return {
    moving: visible && moving,
    rect: visible ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
  };
}
