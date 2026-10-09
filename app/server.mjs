import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BookStorage, StorageError } from "./storage.mjs";
import { preparationState, runPreparationSequence, runPreparationStage } from "./generation.mjs";
import {
  exportChapters,
  finalizeChapter,
  getChapter,
  listChapterVersions,
  listChapters,
  polishChapter,
  regenerateChapter,
  restoreChapterVersion,
  runChapterGeneration,
  saveChapter,
} from "./chapters.mjs";

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = path.join(APP_ROOT, "public");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(payload);
}

function sendText(response, status, body, contentType, downloadName) {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    ...(downloadName
      ? { "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}` }
      : {}),
  });
  response.end(body);
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new StorageError("请求内容过大", 413);
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new StorageError("请求必须是 JSON", 400);
  }
}

async function serveStatic(response, pathname, publicRoot = PUBLIC_ROOT) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const target = path.resolve(publicRoot, `.${requested}`);
  if (!target.startsWith(`${publicRoot}${path.sep}`)) {
    sendJson(response, 404, { error: "页面不存在" });
    return;
  }
  try {
    const content = await fs.readFile(target);
    response.writeHead(200, {
      "content-type": MIME_TYPES[path.extname(target)] ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") sendJson(response, 404, { error: "页面不存在" });
    else throw error;
  }
}

export function createServer({ dataRoot, publicRoot = PUBLIC_ROOT } = {}) {
  const storage = new BookStorage(dataRoot);
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
      if (parts[0] === "api" && parts[1] === "health" && request.method === "GET") {
        sendJson(response, 200, { ok: true, app: "myflow", mode: "mock" });
        return;
      }
      if (parts[0] === "api" && parts[1] === "books") {
        if (parts.length === 2 && request.method === "GET") {
          sendJson(response, 200, { books: await storage.listBooks() });
          return;
        }
        if (parts.length === 2 && request.method === "POST") {
          let book = await storage.createBook(await readBody(request));
          if (book.mode === "auto") ({ book } = await runPreparationSequence(storage, book.slug));
          sendJson(response, 201, { book });
          return;
        }
        if (parts.length === 3 && request.method === "GET") {
          sendJson(response, 200, { book: await storage.getBook(parts[2]) });
          return;
        }
        if (parts.length === 3 && request.method === "PATCH") {
          sendJson(response, 200, { book: await storage.updateBook(parts[2], await readBody(request)) });
          return;
        }
        if (parts.length === 3 && request.method === "DELETE") {
          sendJson(response, 200, await storage.deleteBook(parts[2]));
          return;
        }
        if (parts.length === 4 && parts[3] === "workflow" && request.method === "GET") {
          const book = await storage.getBook(parts[2]);
          sendJson(response, 200, { mode: "mock", stages: preparationState(book), book });
          return;
        }
        if (parts.length === 5 && parts[3] === "workflow" && request.method === "POST") {
          sendJson(response, 200, await runPreparationStage(storage, parts[2], parts[4], await readBody(request)));
          return;
        }
        if (parts.length === 4 && parts[3] === "chapters" && request.method === "GET") {
          sendJson(response, 200, { chapters: await listChapters(storage, parts[2]) });
          return;
        }
        if (parts.length === 5 && parts[3] === "chapters" && request.method === "GET") {
          sendJson(response, 200, await getChapter(storage, parts[2], parts[4]));
          return;
        }
        if (parts.length === 5 && parts[3] === "chapters" && request.method === "PUT") {
          sendJson(response, 200, await saveChapter(storage, parts[2], parts[4], await readBody(request)));
          return;
        }
        if (parts.length === 6 && parts[3] === "chapters" && parts[5] === "versions" && request.method === "GET") {
          sendJson(response, 200, { versions: await listChapterVersions(storage, parts[2], parts[4]) });
          return;
        }
        if (parts.length === 6 && parts[3] === "chapters" && request.method === "POST") {
          const body = await readBody(request);
          const operation = parts[5];
          if (operation === "generate") {
            sendJson(response, 200, await runChapterGeneration(storage, parts[2], parts[4], body));
            return;
          }
          if (operation === "regenerate") {
            sendJson(response, 200, await regenerateChapter(storage, parts[2], parts[4], body));
            return;
          }
          if (operation === "polish") {
            sendJson(response, 200, await polishChapter(storage, parts[2], parts[4]));
            return;
          }
          if (operation === "restore") {
            sendJson(response, 200, await restoreChapterVersion(storage, parts[2], parts[4], body.versionId));
            return;
          }
          if (operation === "finalize" || operation === "post-hoc") {
            sendJson(response, 200, await finalizeChapter(storage, parts[2], parts[4]));
            return;
          }
        }
        if (parts.length === 4 && parts[3] === "export" && request.method === "GET") {
          const exported = await exportChapters(storage, parts[2], {
            format: url.searchParams.get("format") || "md",
            from: url.searchParams.get("from") || undefined,
            to: url.searchParams.get("to") || undefined,
          });
          const contentType = exported.format === "md" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8";
          sendText(response, 200, exported.content, contentType, exported.filename);
          return;
        }
        if (parts.length === 4 && parts[3] === "files" && request.method === "GET") {
          sendJson(response, 200, { files: await storage.listBookFiles(parts[2]) });
          return;
        }
        if (parts.length >= 5 && parts[3] === "files" && request.method === "GET") {
          sendJson(response, 200, { path: parts.slice(4).join("/"), content: await storage.readBookText(parts[2], parts.slice(4).join("/")) });
          return;
        }
      }
      await serveStatic(response, url.pathname, publicRoot);
    } catch (error) {
      const status = error instanceof StorageError ? error.status : 500;
      if (status >= 500) console.error(error);
      sendJson(response, status, { error: error.message || "服务器错误" });
    }
  });
  server.storage = storage;
  server.publicRoot = publicRoot;
  return server;
}

export async function startServer({ port = Number(process.env.PORT || 4317), host = "127.0.0.1", ...options } = {}) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(port, host, resolve));
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const server = await startServer();
  const address = server.address();
  console.log(`myflow 本地写作台：http://127.0.0.1:${address.port}`);
}
