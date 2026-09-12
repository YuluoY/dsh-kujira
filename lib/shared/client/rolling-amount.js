/**
 * @description Normalize the saved session-cost display precision.
 * @param {number} value Requested decimal places.
 * @returns {number} Supported precision from zero to six, defaulting to four.
 */
export function amountDecimals(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(6, Math.floor(value)))
    : 4;
}
/**
 * @description Format currency with stable digit positions across grouping and carry boundaries.
 * @param {number} value Unrounded cost.
 * @param {string} locale Display locale.
 * @param {string} currency Provider currency.
 * @param {number} decimals Display precision.
 * @returns {object} Accessible text, numeric value and individually keyed glyphs.
 */
export function amountParts(value, locale, currency = "CNY", decimals = 4) {
  const digits = amountDecimals(decimals);
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).formatToParts(value);
  let integer = parts
    .filter((p) => p.type === "integer")
    .reduce((sum, p) => sum + p.value.length, 0);
  const cells = parts.flatMap((part, index) =>
    Array.from(part.value).map((char, offset) => ({
      key:
        part.type === "integer"
          ? "i:" + --integer
          : part.type === "fraction"
            ? "f:" + offset
            : part.type + ":" + index + ":" + offset,
      char,
      digit: part.type === "integer" || part.type === "fraction",
    })),
  );
  return { value, text: parts.map((part) => part.value).join(""), cells };
}
/**
 * @description Coalesce updates into one latest pending amount while a short transition completes.
 * @param {object} initial Initial formatted amount.
 * @param {Function} emit Publish a render frame.
 * @param {object} clock Injectable timing dependencies.
 * @returns {object} Update and disposal operations.
 */
export function createAmountTransition(
  initial,
  emit,
  { schedule = setTimeout, cancel = clearTimeout } = {},
) {
  let current = initial,
    pending = null,
    timer = null,
    disposed = false,
    revision = 0;
  const show = (next, animate = true) => {
    if (disposed) return;
    if (!animate) {
      cancel(timer);
      timer = null;
      pending = null;
      current = next;
      emit({ current, previous: null, revision: ++revision });
      return;
    }
    if (timer !== null) {
      pending = next;
      return;
    }
    if (next.text === current.text) {
      current = next;
      return;
    }
    const previous = current;
    current = next;
    emit({
      current,
      previous,
      revision: ++revision,
      direction: next.value >= previous.value ? "up" : "down",
    });
    timer = schedule(() => {
      timer = null;
      if (disposed) return;
      const nextPending = pending;
      pending = null;
      if (nextPending && nextPending.text !== current.text) show(nextPending);
      else emit({ current, previous: null, revision });
    }, 340);
  };
  return {
    update: show,
    dispose() {
      disposed = true;
      cancel(timer);
      pending = null;
    },
  };
}
/**
 * @description Build an accessible currency readout with brief per-digit vertical transitions.
 * @param {object} React Host React runtime.
 * @returns {Function} Rolling amount component.
 */
export function createRollingAmount(React) {
  const h = React.createElement;
  return function RollingAmount({
    value,
    locale,
    currency,
    decimals,
    reduced,
  }) {
    const formatted = React.useMemo(
      () => amountParts(value, locale, currency, decimals),
      [value, locale, currency, decimals],
    );
    const [frame, setFrame] = React.useState(() => ({
      current: formatted,
      previous: null,
      revision: 0,
    }));
    const controller = React.useRef(null);
    React.useEffect(() => {
      controller.current = createAmountTransition(formatted, setFrame);
      return () => controller.current.dispose();
    }, []);
    React.useEffect(() => {
      controller.current.update(formatted, !reduced && !document.hidden);
    }, [formatted, reduced]);
    const old = new Map(
      frame.previous?.cells.map((cell) => [cell.key, cell.char]) || [],
    );
    return h(
      "span",
      {
        className: "kj-rolling-amount",
        "aria-hidden": true,
        "data-amount": frame.current.text,
      },
      ...frame.current.cells.map((cell) => {
        const from = old.get(cell.key);
        const moving =
          cell.digit && from !== undefined && from !== cell.char && !reduced;
        if (!moving)
          return h(
            "span",
            {
              key: cell.key,
              className: cell.digit ? "kj-amount-digit" : "kj-amount-symbol",
            },
            cell.char,
          );
        const chars =
          frame.direction === "up" ? [from, cell.char] : [cell.char, from];
        return h(
          "span",
          { key: cell.key, className: "kj-amount-digit" },
          h(
            "span",
            {
              key: frame.revision,
              className: "kj-amount-track",
              "data-direction": frame.direction,
            },
            ...chars.map((char, index) => h("span", { key: index }, char)),
          ),
        );
      }),
    );
  };
}
