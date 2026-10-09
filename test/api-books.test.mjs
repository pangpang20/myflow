import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startServer } from "../app/server.mjs";

test("书架 API 支持完整的 CRUD 生命周期", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "myflow-api-"));
  const server = await startServer({ port: 0, dataRoot: root });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const input = {
    slug: "api-book",
    title: "接口之书",
    premise: "测试一条完整的本地创作链路。",
    genre: "现实",
    style: "冷静",
    length: "长篇",
    chapterWords: "3000",
  };

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).mode, "mock");
  const created = await fetch(`${base}/api/books`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).book.slug, "api-book");
  const listed = await fetch(`${base}/api/books`);
  assert.equal((await listed.json()).books.length, 1);
  const patched = await fetch(`${base}/api/books/api-book`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ style: "克制" }) });
  assert.equal((await patched.json()).book.style, "克制");
  const deleted = await fetch(`${base}/api/books/api-book`, { method: "DELETE" });
  assert.equal((await deleted.json()).deleted, true);
  assert.equal((await (await fetch(`${base}/api/books`)).json()).books.length, 0);
});

