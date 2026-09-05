import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../web", import.meta.url)));
const port = Number(process.env.WEB_PORT ?? 4173);
const contentTypes: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

const server = createServer(async (request, response) => {
  const requested = request.url === "/" ? "index.html" : request.url?.replace(/^\//, "") ?? "index.html";
  const file = resolve(root, requested);
  if (!file.startsWith(root)) {
    response.writeHead(403); response.end("Forbidden"); return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404); response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Interface Jumanji disponível em http://localhost:${port}`));
