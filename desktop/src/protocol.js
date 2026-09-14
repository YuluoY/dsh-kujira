import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * @description Serve packaged assets through a local protocol and proxy only plugin data routes.
 */
export function createProtocol({ runtime, desktopRoot, net, connection }) {
  return async (request) => {
    const url = new URL(request.url);
    if (url.host !== "app") return new Response("", { status: 403 });
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return new Response("", { status: 400 });
    }
    if (
      path.includes("\\") ||
      path.split("/").includes("..") ||
      path.includes("\0")
    )
      return new Response("", { status: 403 });
    let root, relative;
    if (path === "/" || path === "/index.html") {
      root = desktopRoot;
      relative = "ui/index.html";
    } else if (path.startsWith("/ui/")) {
      root = desktopRoot;
      relative = path.slice(1);
    } else if (path === "/react.js") {
      root = desktopRoot;
      relative = "node_modules/react/umd/react.production.min.js";
    } else if (path === "/react-dom.js") {
      root = desktopRoot;
      relative = "node_modules/react-dom/umd/react-dom.production.min.js";
    } else if (path === "/dsh-kujira/config.json") {
      root = runtime;
      relative = "assets/pet.config.json";
    } else if (path.startsWith("/dsh-kujira/anim/") && path.endsWith(".webm")) {
      root = join(runtime, "assets/anim");
      relative = path.slice(17);
    } else if (
      /^\/dsh-kujira\/(shared\/.+\.js|styles\/[a-z-]+\.css|appearance\.css)$/.test(
        path,
      )
    ) {
      root = join(runtime, "lib");
      relative = path.slice(12);
    } else if (path.startsWith("/dsh-kujira/"))
      return connection.proxy(request, path.slice(12) + url.search);
    else return new Response("", { status: 404 });
    const file = resolve(root, relative);
    if (!file.startsWith(resolve(root) + sep))
      return new Response("", { status: 403 });
    if (request.method !== "GET") return new Response("", { status: 405 });
    try {
      const response = await net.fetch(pathToFileURL(file).href, {
        headers: request.headers,
      });
      if (!/\.(?:js|css|html)$/.test(file)) return response;
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store");
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response("", { status: 404 });
    }
  };
}
