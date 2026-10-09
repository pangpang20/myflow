import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startServer } from "../app/server.mjs";

async function jsonRequest(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => null);
  assert.equal(response.ok, true, `${options.method || "GET"} ${pathname} failed: ${JSON.stringify(body)}`);
  return body;
}

test("本地 HTTP 服务可以从建书走到导出并在重启后恢复", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "myflow-e2e-"));
  const book = {
    slug: "e2e-novel",
    title: "潮汐之后",
    premise: "一座城市开始记得尚未发生的事。",
    genre: "悬疑科幻",
    style: "克制、清醒",
    length: "长篇",
    chapterWords: "2500-3500",
    mode: "review",
  };

  const firstServer = await startServer({ port: 0, dataRoot: root });
  const firstBase = `http://127.0.0.1:${firstServer.address().port}`;
  const created = await jsonRequest(firstBase, "/api/books", { method: "POST", body: JSON.stringify(book) });
  assert.equal(created.book.slug, book.slug);
  for (const stage of ["world", "characters", "story", "outline"]) {
    const result = await jsonRequest(firstBase, `/api/books/${book.slug}/workflow/${stage}`, { method: "POST", body: "{}" });
    assert.equal(result.run.status, "completed");
  }
  const generated = await jsonRequest(firstBase, `/api/books/${book.slug}/chapters/1/generate`, { method: "POST", body: JSON.stringify({ guidance: "让第一章留下一个可验证的悬念。" }) });
  const saved = await jsonRequest(firstBase, `/api/books/${book.slug}/chapters/1`, { method: "PUT", body: JSON.stringify({ content: `${generated.content}\n\n这是作者亲自补上的收束。` }) });
  assert.ok(saved.versionId);
  const finalized = await jsonRequest(firstBase, `/api/books/${book.slug}/chapters/1/finalize`, { method: "POST", body: "{}" });
  assert.equal(finalized.chapter.status, "finalized");
  const markdown = await fetch(`${firstBase}/api/books/${book.slug}/export?format=md`);
  assert.equal(markdown.status, 200);
  assert.match(await markdown.text(), /作者亲自补上的收束/);
  firstServer.close();

  const secondServer = await startServer({ port: 0, dataRoot: root });
  try {
    const secondBase = `http://127.0.0.1:${secondServer.address().port}`;
    const restoredBook = await jsonRequest(secondBase, `/api/books/${book.slug}`);
    assert.deepEqual(restoredBook.book.completedStages, ["world", "characters", "story", "outline"]);
    const restoredChapter = await jsonRequest(secondBase, `/api/books/${book.slug}/chapters/0001`);
    assert.equal(restoredChapter.chapter.status, "finalized");
    assert.match(restoredChapter.content, /作者亲自补上的收束/);
    const files = await jsonRequest(secondBase, `/api/books/${book.slug}/files`);
    assert.ok(files.files.includes("story/0001/chapter.md"));
    assert.ok(files.files.includes("story/0001/post-hoc.json"));
  } finally {
    secondServer.close();
  }
});

