/**
 * @description Keep a bounded transparent window and the mascot inside a display work area.
 */
export function windowPlacement(
  area,
  pet,
  size,
  viewport = { width: 820, height: 740 },
) {
  const clamp = (n, a, b) => Math.max(a, Math.min(n, Math.max(a, b)));
  const width = Math.min(viewport.width, area.width),
    height = Math.min(viewport.height, area.height);
  const px = clamp(pet.x, area.x, area.x + area.width - size),
    py = clamp(pet.y, area.y, area.y + area.height - size);
  const x = clamp(px - (width - size) / 2, area.x, area.x + area.width - width);
  const y = clamp(
    py - (height - size) * 0.75,
    area.y,
    area.y + area.height - height,
  );
  return {
    bounds: {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    },
    pet: { x: Math.round(px - x), y: Math.round(py - y), size },
    screenPet: { x: px, y: py },
  };
}
