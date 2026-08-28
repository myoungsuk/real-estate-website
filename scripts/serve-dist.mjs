import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : 4321);
const host = "127.0.0.1";
const root = resolve("dist");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
};

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("--port에는 유효한 포트 번호가 필요합니다.");
}

async function existingFile(pathname) {
  const candidates = pathname.endsWith("/")
    ? [`${pathname}index.html`]
    : [pathname, `${pathname}/index.html`];

  for (const candidate of candidates) {
    const file = resolve(root, `.${candidate}`);
    if (file !== root && !file.startsWith(`${root}${sep}`)) continue;
    try {
      if ((await stat(file)).isFile()) return file;
    } catch {
      // 다음 후보 또는 404 문서를 사용합니다.
    }
  }
  return null;
}

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", `http://${host}`).pathname);
    const file = await existingFile(pathname);
    const status = file ? 200 : 404;
    const responseFile = file ?? resolve(root, "404.html");
    const body = await readFile(responseFile);
    response.writeHead(status, {
      "Content-Type": contentTypes[extname(responseFile)] ?? "application/octet-stream",
      "Content-Length": body.byteLength,
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : "Internal Server Error");
  }
});

server.listen(port, host, () => {
  console.log(`dist server listening at http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 1_000);
  });
}
