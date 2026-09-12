import { Lexer } from "../vendor/marked.js";
import { t } from "../i18n.js";

const decode = (text = "") =>
  text.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (raw, entity) => {
      const named = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: "\u00a0",
      };
      if (named[entity]) return named[entity];
      const point =
        entity[1]?.toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : raw;
    },
  );

/**
 * @description Extract the first readable paragraph for the collapsed result preview.
 * @param {string} text Markdown result.
 * @returns {string} Short plain-text summary.
 */
export function markdownExcerpt(text = "", limit = 160) {
  try {
    const tokens = Lexer.lex(String(text).slice(0, 12000), { gfm: true });
    const first =
      tokens.find((token) => token.type === "paragraph") ||
      tokens.find((token) => token.type === "heading");
    const flatten = (token) =>
      token.tokens ? token.tokens.map(flatten).join("") : token.text || "";
    const summary = decode(first ? flatten(first) : String(text))
      .replace(/\s+/g, " ")
      .trim();
    return summary.length > limit ? summary.slice(0, limit) + "…" : summary;
  } catch {
    return String(text).slice(0, limit);
  }
}

/**
 * @description Render Markdown tokens as React elements without executable HTML.
 * @param {object} React Host React instance.
 * @returns {Function} Markdown result component.
 */
export function createMarkdown(React) {
  const h = React.createElement;
  return function Markdown({ text = "", onOpenFile }) {
    const source = String(text).slice(0, 12000);
    const tokens = React.useMemo(() => {
      try {
        return Lexer.lex(source, { gfm: true });
      } catch {
        return [{ type: "paragraph", text: source }];
      }
    }, [source]);
    const render = (items, depth = 0) =>
      depth > 24
        ? (items || []).map(token => token.raw || token.text || "").join("")
        : (items || []).map((token, key) => {
            const children = () =>
              token.tokens
                ? render(token.tokens, depth + 1)
                : decode(token.text);
            const props = { key };
            switch (token.type) {
              case "space":
                return null;
              case "heading":
                return h("h" + Math.min(6, token.depth + 2), props, children());
              case "paragraph":
                return h("p", props, children());
              case "strong":
                return h("strong", props, children());
              case "em":
                return h("em", props, children());
              case "del":
                return h("del", props, children());
              case "br":
                return h("br", props);
              case "hr":
                return h("hr", props);
              case "codespan":
                return h("code", props, token.text);
              case "code":
                return h(
                  "pre",
                  {
                    ...props,
                    tabIndex: 0,
                    "aria-label": token.lang || t("代码"),
                  },
                  h("code", null, token.text),
                );
              case "blockquote":
                return h("blockquote", props, children());
              case "list":
                return h(
                  token.ordered ? "ol" : "ul",
                  { ...props, start: token.ordered ? token.start : undefined },
                  render(token.items, depth + 1),
                );
              case "list_item":
                return h(
                  "li",
                  {
                    ...props,
                    className: token.task ? "kj-md-task" : undefined,
                  },
                  children(),
                );
              case "checkbox":
                return h("input", {
                  ...props,
                  type: "checkbox",
                  checked: token.checked,
                  disabled: true,
                  "aria-label": t(token.checked ? "已完成" : "未完成"),
                });
              case "table": {
                const cells = (row, header) =>
                  row.map((cell, index) =>
                    h(
                      header ? "th" : "td",
                      {
                        key: index,
                        scope: header ? "col" : undefined,
                        style: { textAlign: cell.align || "start" },
                      },
                      render(cell.tokens, depth + 1),
                    ),
                  );
                return h(
                  "div",
                  {
                    ...props,
                    className: "kj-md-table",
                    tabIndex: 0,
                    role: "region",
                    "aria-label": t("结果表格"),
                  },
                  h(
                    "table",
                    null,
                    h("thead", null, h("tr", null, cells(token.header, true))),
                    h(
                      "tbody",
                      null,
                      token.rows.map((row, index) =>
                        h("tr", { key: index }, cells(row, false)),
                      ),
                    ),
                  ),
                );
              }
              case "link":
              case "image": {
                const href = decode(token.href || "").trim();
                const label =
                  token.type === "image"
                    ? decode(token.text) || t("查看图片")
                    : children();
                if (/^(https?:\/\/|mailto:)/i.test(href))
                  return h(
                    "a",
                    {
                      ...props,
                      href,
                      target: "_blank",
                      rel: "noopener noreferrer",
                    },
                    label,
                  );
                if (
                  onOpenFile &&
                  href &&
                  !Array.from(href).some(
                    (char) => char === ":" || char.charCodeAt(0) <= 32,
                  ) &&
                  !href.startsWith("//") &&
                  !href.startsWith("#")
                )
                  return h(
                    "button",
                    {
                      ...props,
                      type: "button",
                      className: "kj-md-file",
                      onClick: () => onOpenFile(href),
                    },
                    label,
                  );
                return h("span", props, label);
              }
              case "html":
                return h("code", props, token.text);
              default:
                return token.tokens
                  ? h(React.Fragment, props, children())
                  : decode(token.text || token.raw);
            }
          });
    return h("div", { className: "kj-markdown" }, render(tokens));
  };
}
