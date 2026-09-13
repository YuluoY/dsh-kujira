/**
 * @description Ignore independent host panes; only scrolling an anchor ancestor changes popup geometry.
 * @param {EventTarget} target Scrolled element or document.
 * @param {Element} anchor Select wrapper.
 * @param {Document} documentNode Owner document.
 * @returns {boolean} Whether the popup needs repositioning.
 */
export function isSelectAnchorScroll(target, anchor, documentNode) {
  return target === documentNode || !!target?.contains?.(anchor);
}
/**
 * @description Create a controlled searchable select with explicit selection and clearing.
 * @param {object} React Host React.
 * @param {object} helpers Translated elements, messages and floating geometry.
 * @returns {Function} SearchSelect component.
 */
export function createSearchSelect(React, { h, t, position }) {
  return function SearchSelect({
    label,
    value = "",
    options = [],
    onChange,
    disabled = false,
    loading = false,
    error = "",
  }) {
    const id = React.useId(),
      box = React.useRef(null),
      input = React.useRef(null),
      popup = React.useRef(null);
    const [open, setOpen] = React.useState(false),
      [query, setQuery] = React.useState(""),
      [active, setActive] = React.useState(-1);
    const unavailable = disabled || loading;
    const suppressFocus = React.useRef(false);
    const selected = options.find((o) => o[0] === value);
    const labels = options.map(([key, text]) => [key, t(text)]);
    const matches = labels.filter(([, text]) =>
      text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    );
    const close = () => {
      setOpen(false);
      setQuery("");
      setActive(-1);
    };
    const commit = (item) => {
      if (!item || unavailable) return;
      close();
      if (item[0] !== value) onChange(item[0]);
    };
    React.useEffect(() => {
      if (unavailable) close();
    }, [unavailable]);
    React.useLayoutEffect(() => {
      if (!open || unavailable) return;
      const list = popup.current;
      list.showPopover?.();
      const place = () => {
        const rect = box.current.getBoundingClientRect();
        const p = position(
          rect,
          {
            width: Math.max(164, rect.width),
            height: Math.min(280, Math.max(1, matches.length) * (innerWidth <= 600 ? 40 : 34) + 8),
          },
          { width: innerWidth, height: innerHeight },
        );
        Object.assign(list.style, {
          left: p.left + "px",
          top: p.top + "px",
          width: p.width + "px",
          maxHeight: p.maxHeight + "px",
        });
      };
      place();
      const outside = (e) => {
        if (!box.current.contains(e.target) && !list.contains(e.target)) close();
      };
      const scroll = (e) => {
        if (isSelectAnchorScroll(e.target, box.current, document)) place();
      };
      const collapse = (e) => {
        if (
          e.target.tagName === "DETAILS" &&
          !e.target.open &&
          e.target.contains(box.current)
        )
          close();
      };
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("scroll", scroll, true);
      document.addEventListener("toggle", collapse, true);
      window.addEventListener("resize", place);
      const observer = new ResizeObserver(place);
      observer.observe(box.current);
      return () => {
        if (list.matches(":popover-open")) list.hidePopover();
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("scroll", scroll, true);
        document.removeEventListener("toggle", collapse, true);
        window.removeEventListener("resize", place);
        observer.disconnect();
      };
    }, [open, unavailable, matches.length]);
    React.useLayoutEffect(() => {
      if (open && active >= 0)
        popup.current?.children[active]?.scrollIntoView({ block: "nearest" });
    }, [open, active]);
    const show = () => {
      if (!unavailable) { setOpen(true); setActive(-1); }
    };
    const keys = (e) => {
      if (
        unavailable ||
        e.nativeEvent?.isComposing ||
        e.isComposing ||
        e.keyCode === 229
      )
        return;
      if (e.key === "Escape") {
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
        return;
      }
      if (e.key === "Tab") {
        close();
        return;
      }
      if (["ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
        setActive((i) =>
          Math.max(
            0,
            Math.min(matches.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)),
          ),
        );
      } else if (e.key === "Enter" && open) {
        e.preventDefault();
        e.stopPropagation();
        commit(
          active >= 0
            ? matches[active]
            : matches.find(([, text]) => text === query.trim()),
        );
      }
    };
    const icon = (path) =>
      h(
        "svg",
        { viewBox: "0 0 16 16", "aria-hidden": true },
        h("path", {
          d: path,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.5,
          strokeLinecap: "round",
        }),
      );
    return h(
      "div",
      { ref: box, className: "kj-select kj-search-select" },
      h(
        "div",
        {
          className: "kj-select-trigger kj-search-select-control",
          "data-open": open || undefined,
          "aria-invalid": !!error,
          "data-disabled": unavailable || undefined,
        },
        h("input", {
          ref: input,
          type: "text",
          autoComplete: "off",
          role: "combobox",
          "aria-label": label,
          "aria-autocomplete": "list",
          "aria-haspopup": "listbox",
          "aria-expanded": open,
          "aria-controls": open ? id : undefined,
          "aria-activedescendant":
            open && matches[active] ? id + "-" + active : undefined,
          "aria-invalid": !!error,
          "aria-describedby": error ? id + "-error" : undefined,
          disabled: unavailable,
          placeholder: loading ? t("正在读取") : t("输入检索"),
          value: open ? query : selected ? t(selected[1]) : "",
          onFocus: () => {
            if (suppressFocus.current) return;
            if (!unavailable) {
              setQuery("");
              setActive(-1);
              setOpen(true);
            }
          },
          onClick: show,
          onKeyDown: keys,
          onChange: (e) => {
            setQuery(e.target.value);
            setActive(-1);
            setOpen(true);
          },
          onBlur: (e) => {
            if (!box.current.contains(e.relatedTarget) && !popup.current?.contains(e.relatedTarget)) close();
          },
        }),
        value || query
          ? h(
              "button",
              {
                type: "button",
                className: "kj-search-clear",
                tabIndex: 0,
                "aria-label": t("清除选择"),
                disabled: unavailable,
                onPointerDown: (e) => e.preventDefault(),
                onClick: () => {
                  close();
                  if (value) onChange("");
                  suppressFocus.current = true;
                  input.current?.focus();
                  suppressFocus.current = false;
                },
              },
              icon("M4 4l8 8M12 4l-8 8"),
            )
          : null,
        h(
          "button",
          {
            type: "button",
            className: "kj-search-open",
            tabIndex: -1,
            "aria-label": t("展开选项"),
            disabled: unavailable,
            onPointerDown: (e) => e.preventDefault(),
            onClick: () => {
              if (open) close();
              else {
                input.current?.focus();
                setOpen(true);
              }
            },
          },
          icon("m4 6 4 4 4-4"),
        ),
      ),
      open
        ? h(
            "div",
            {
              ref: popup,
              id,
              role: "listbox",
              "aria-label": label,
              popover: "manual",
              className: "kj-select-list kj-search-menu",
            },
            matches.length
              ? matches.map((item, i) =>
                  h(
                    "div",
                    {
                      key: item[0],
                      id: id + "-" + i,
                      role: "option",
                      "aria-selected": item[0] === value,
                      "data-active": i === active ? "1" : "0",
                      onPointerMove: () => setActive(i),
                      className: "kj-select-option",
                      onPointerDown: (e) => e.preventDefault(),
                      onClick: () => commit(item),
                    },
                    h("span", null, item[1]),
                    item[0] === value ? icon("m3 8 3 3 7-7") : null,
                  ),
                )
              : h(
                  "div",
                  { className: "kj-select-empty", role: "status" },
                  t("没有匹配结果"),
                ),
          )
        : null,
      error
        ? h("p", { id: id + "-error", className: "err", role: "status" }, error)
        : null,
    );
  };
}
