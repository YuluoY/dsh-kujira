import { windowPlacement } from "./window-layout.js";

/**
 * @description Manage bounded native placement and transparent hit testing across supported desktops.
 */
export function createWindowController({ win, screen, store, capabilities }) {
  let size = 260,
    drag = null,
    pressed = false,
    regions = [],
    timer,
    ignored = false,
    disposed = false,
    placed = false,
    lastPosition = "";
  const saved = store.get().position;
  let savedPosition = JSON.stringify(saved);
  let pet =
    saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
      ? { x: saved.x, y: saved.y }
      : null;
  const persistPosition = () => {
    const body = JSON.stringify(pet);
    if (!pet || body === savedPosition || !store.save) return;
    savedPosition = body;
    store.save({ position: { ...pet } }).catch(() => {
      savedPosition = "";
      console.warn("[kujira] Position save failed");
    });
  };
  const chooseDisplay = () => {
    const mode = store.get().settings.display;
    if (mode === "cursor")
      return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (mode === "remember" && pet) return screen.getDisplayNearestPoint(pet);
    return screen.getPrimaryDisplay();
  };
  const place = (nextSize = size, reset = false) => {
    const previousSize = size;
    size = Number.isFinite(nextSize)
      ? Math.max(120, Math.min(360, nextSize))
      : size;
    if (capabilities.wayland) return;
    const display = chooseDisplay(),
      area = display.workArea;
    if (placed && pet && !reset && size !== previousSize) {
      const delta = previousSize - size;
      const left = pet.x - area.x;
      const right = area.x + area.width - pet.x - previousSize;
      pet = {
        x: pet.x + (left <= 32 ? 0 : right <= 32 ? delta : delta / 2),
        y: pet.y + (pet.y - area.y <= 32 ? 0 : delta),
      };
    }
    if (!pet || reset)
      pet = {
        x: area.x + area.width - size - 24,
        y: area.y + area.height - size - 16,
      };
    const layout = windowPlacement(area, pet, size);
    pet = layout.screenPet;
    const current = win.getBounds();
    if (
      Object.entries(layout.bounds).some(
        ([key, value]) => current[key] !== value,
      )
    )
      win.setBounds(layout.bounds);
    const position = JSON.stringify(layout.pet);
    if (position !== lastPosition)
      win.webContents.send("kujira:position", layout.pet);
    lastPosition = position;
    placed = true;
    persistPosition();
  };
  const setIgnored = (value) => {
    if (ignored === value) return;
    ignored = value;
    win.setIgnoreMouseEvents(value, { forward: true });
  };
  const check = () => {
    if (disposed || win.isDestroyed()) return;
    const enabled =
      capabilities.clickThrough &&
      store.get().settings.clickThrough &&
      win.isVisible();
    if (!enabled) {
      setIgnored(false);
      timer = setTimeout(check, 500);
      return;
    }
    const cursor = screen.getCursorScreenPoint(),
      bounds = win.getBounds(),
      x = cursor.x - bounds.x,
      y = cursor.y - bounds.y;
    const inside = x >= 0 && y >= 0 && x < bounds.width && y < bounds.height;
    const hit =
      pressed ||
      drag ||
      regions.some(
        (r) =>
          x >= r.x && y >= r.y && x <= r.x + r.width && y <= r.y + r.height,
      );
    setIgnored(!hit);
    timer = setTimeout(check, inside ? 80 : 300);
  };
  const recover = () => place();
  screen.on("display-added", recover);
  screen.on("display-removed", recover);
  screen.on("display-metrics-changed", recover);
  check();
  return {
    place,
    releasePointer: () => {
      pressed = false;
      clearTimeout(timer);
      check();
    },
    pointer: (point) => {
      if (!point || ![point.x, point.y].every(Number.isFinite)) return;
      if (typeof point.pressed === "boolean") pressed = point.pressed;
      if (point.pressed === true && !win.isFocused?.()) win.focus?.();
      if (
        !capabilities.clickThrough ||
        !store.get().settings.clickThrough ||
        !win.isVisible()
      )
        return;
      const hit =
        pressed ||
        drag ||
        regions.some(
          (r) =>
            point.x >= r.x &&
            point.y >= r.y &&
            point.x <= r.x + r.width &&
            point.y <= r.y + r.height,
        );
      setIgnored(!hit);
    },
    regions: (value) => {
      if (Array.isArray(value))
        regions = value
          .slice(0, 32)
          .filter(
            (r) =>
              r &&
              [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
              r.width >= 0 &&
              r.height >= 0 &&
              r.width <= 2000 &&
              r.height <= 2000,
          );
      clearTimeout(timer);
      check();
    },
    start: (rect) => {
      if (
        !capabilities.position ||
        !rect ||
        ![rect.x, rect.y, rect.width].every(Number.isFinite)
      )
        return;
      const cursor = screen.getCursorScreenPoint(),
        bounds = win.getBounds();
      drag = {
        x: cursor.x - bounds.x - rect.x,
        y: cursor.y - bounds.y - rect.y,
      };
      setIgnored(false);
    },
    move: () => {
      if (!drag) return;
      const cursor = screen.getCursorScreenPoint();
      pet = { x: cursor.x - drag.x, y: cursor.y - drag.y };
      const area = screen.getDisplayNearestPoint(cursor).workArea,
        layout = windowPlacement(area, pet, size);
      pet = layout.screenPet;
      win.setBounds(layout.bounds);
      win.webContents.send("kujira:position", layout.pet);
    },
    end: () => {
      drag = null;
      persistPosition();
    },
    dispose: () => {
      persistPosition();
      disposed = true;
      clearTimeout(timer);
      for (const event of [
        "display-added",
        "display-removed",
        "display-metrics-changed",
      ])
        screen.removeListener(event, recover);
    },
  };
}
