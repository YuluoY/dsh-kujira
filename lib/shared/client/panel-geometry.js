/**
 * @description Position panels using their measured height and cap their reading area.
 * @param {{top:number,height:number}} anchor Mascot viewport rectangle.
 * @param {{w:number,h:number}} viewport Available viewport.
 * @param {number} panelHeight Measured panel height after applying the viewport limit.
 * @returns {{top:number,maxHeight:number}} Stable viewport position and size limit.
 */
export function panelGeometry(anchor, viewport, panelHeight = 260) {
  const margin = 12;
  const maxHeight = Math.max(
    0,
    Math.min(520, Math.floor(viewport.h * 0.78), viewport.h - margin * 2),
  );
  const preferred = anchor.top + anchor.height * 0.5 - 80;
  const reserve = Math.min(maxHeight, Math.max(0, panelHeight));
  const top = Math.max(
    margin,
    Math.min(preferred, viewport.h - reserve - margin),
  );
  return {
    top,
    maxHeight: Math.max(0, Math.min(maxHeight, viewport.h - top - margin)),
  };
}
