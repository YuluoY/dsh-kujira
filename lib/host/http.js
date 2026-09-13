import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { normalize, resolve, sep, join } from "node:path";
import { createHash } from "node:crypto";
import { STYLE_FILES } from "./resources.js";

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webm": "video/webm",
};

/**
 * 把请求里的相对路径解析成绝对路径，并做防目录穿越校验。
 *
 * @returns 合法则返回绝对路径；非法返回 undefined
 */
export function resolveInside(root, relative) {
  const cleaned = normalize(relative).replace(/^([/\\])+/, "");
  const full = resolve(root, cleaned);

  if (full !== root && !full.startsWith(root + sep)) {
    return undefined;
  }
  return full;
}

// 发 JSON（一律不缓存，保证改完配置刷新即生效）。
export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(body)),
    "cache-control": "no-store",
  });
  res.end(body);
}

// 发纯文本。
export function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

/**
 * 流式发一个文件。
 * 返回 true 表示已接管响应（文件存在）；false 表示文件不存在，调用方自己回 404。
 */
export async function sendFile(req, res, file, ext, cacheControl) {
  let info;
  try {
    info = await stat(file);
  } catch (error) {
    return false;
  }

  if (!info.isFile()) return false;
  const etag = `"${info.size}-${info.mtimeMs}"`;
  if (req.headers?.["if-none-match"] === etag) {
    res.writeHead(304, { etag: etag, "cache-control": cacheControl });
    res.end();
    return true;
  }
  let start = 0,
    end = info.size - 1,
    status = 200;
  const range = ext === ".webm" && req.headers?.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      start = match[1]
        ? Number(match[1])
        : Math.max(0, info.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(end, Number(match[2])) : end;
    }
    if (
      !match ||
      (!match[1] && !match[2]) ||
      !Number.isSafeInteger(start) ||
      start > end ||
      start >= info.size
    ) {
      res.writeHead(416, { "content-range": `bytes */${info.size}` });
      res.end();
      return true;
    }
    status = 206;
  }
  res.writeHead(status, {
    "content-type": MIME[ext] || "application/octet-stream",
    "content-length": String(Math.max(0, end - start + 1)),
    "cache-control": cacheControl,
    etag: etag,
    ...(ext === ".webm" ? { "accept-ranges": "bytes" } : {}),
    ...(status === 206
      ? { "content-range": `bytes ${start}-${end}/${info.size}` }
      : {}),
  });

  if (req.method === "HEAD") {
    res.end();
    return true;
  }

  // 流式发送：此时 200 头已经写出去了，出错只能断开连接，
  // 再回错误响应会触发 "headers already sent"。
  const stream = createReadStream(file, info.size ? { start, end } : {});
  const cancel = () => stream.destroy();
  res.once?.("close", cancel);
  req.once?.("aborted", cancel);
  stream.once("close", () => {
    res.off?.("close", cancel);
    req.off?.("aborted", cancel);
  });
  stream.on("error", () => {
    try {
      res.destroy();
    } catch (error) {
      // 已经断了，无所谓
    }
  });
  stream.pipe(res);
  return true;
}

/**
 * @description Bind read-only work to the response lifetime and a total deadline.
 * @param {object} req HTTP request.
 * @param {object} res HTTP response.
 * @returns {AbortController} Request cancellation scope.
 */
export function requestScope(req, res) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(Error("request-deadline")),
    8000,
  );
  timer.unref?.();
  const close = () => {
    clearTimeout(timer);
    controller.abort(Error("response-closed"));
    req.off?.("aborted", close);
    res.off?.("close", close);
    res.off?.("finish", close);
  };
  req.once?.("aborted", close);
  res.once?.("close", close);
  res.once?.("finish", close);
  return controller;
}

const styles = new Map();
/**
 * @description Reuse a stylesheet body until its source files change and honor conditional requests.
 * @param {object} req HTTP request.
 * @param {object} res HTTP response.
 * @param {string} root Package directory.
 * @returns {Promise<void>} Completed stylesheet response.
 */
export async function sendStyles(req, res, root) {
  const files = STYLE_FILES.map((file) => join(root, "lib", "styles", file));
  const info = await Promise.all(files.map((file) => stat(file)));
  const fingerprint = info
    .map((value) => `${value.mtimeMs}:${value.size}`)
    .join("|");
  let value = styles.get(root);
  if (value?.fingerprint !== fingerprint) {
    const body = (
      await Promise.all(files.map((file) => readFile(file, "utf8")))
    ).join("\n");
    value = {
      fingerprint,
      body,
      etag: '"' + createHash("sha256").update(body).digest("hex") + '"',
    };
    styles.set(root, value);
    if (styles.size > 4) styles.delete(styles.keys().next().value);
  }
  const unchanged = req.headers?.["if-none-match"] === value.etag;
  res.writeHead(unchanged ? 304 : 200, {
    "content-type": "text/css; charset=utf-8",
    "cache-control": "no-cache",
    etag: value.etag,
    ...(!unchanged
      ? { "content-length": String(Buffer.byteLength(value.body)) }
      : {}),
  });
  res.end(unchanged || req.method === "HEAD" ? undefined : value.body);
}
