/**
 * @description Position panels independently of content height and cap their reading area.
 * @param {{top:number,height:number}} anchor Mascot viewport rectangle.
 * @param {{w:number,h:number}} viewport Available viewport.
 * @returns {{top:number,maxHeight:number}} Stable viewport position and size limit.
 */
export function panelGeometry(anchor, viewport) {
  const margin = 12;
  const maxHeight = Math.max(
    0,
    Math.min(520, Math.floor(viewport.h * 0.78), viewport.h - margin * 2),
  );
  const wanted =
    viewport.w <= 600
      ? viewport.h >= 480
        ? 60
        : margin
      : anchor.top + anchor.height * 0.42 - 120;
  const top = Math.max(
    margin,
    Math.min(wanted, viewport.h - maxHeight - margin),
  );
  return {
    top,
    maxHeight: Math.max(0, Math.min(maxHeight, viewport.h - top - margin)),
  };
}
