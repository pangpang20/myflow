import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startServer } from "../app/server.mjs";

test("建书工作流 API 返回阶段状态和生成文件", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "myflow-workflow-api-"));
  const server = await startServer({ port: 0, dataRoot: root });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${base}/api/books`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug: "workflow-api", title: "工作流 API", premise: "让状态可以被验证。", genre: "科幻", style: "清醒", length: "中篇", chapterWords: "2500" }),
  });
  const locked = await fetch(`${base}/api/books/workflow-api/workflow/characters`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(locked.status, 409);
  const world = await fetch(`${base}/api/books/workflow-api/workflow/world`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal((await world.json()).run.workflowId, "bishu-novel-build");
  const files = await fetch(`${base}/api/books/workflow-api/files`);
  assert.ok((await files.json()).files.includes("meta/world_foundation.md"));
  const file = await fetch(`${base}/api/books/workflow-api/files/meta%2Fworld_foundation.md`);
  assert.equal(file.status, 200);
  assert.match((await file.json()).content, /世界观基础/);
});

test("自动推进模式在建书时完成四阶段且书籍更新不能伪造进度", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "myflow-auto-api-"));
  const server = await startServer({ port: 0, dataRoot: root });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const input = { slug: "auto-book", title: "自动之书", premise: "让世界自动建立。", genre: "奇幻", style: "轻盈", length: "长篇", chapterWords: "2500", mode: "auto" };
  const created = await fetch(`${base}/api/books`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  assert.equal(created.status, 201);
  assert.deepEqual((await created.json()).book.completedStages, ["world", "characters", "story", "outline"]);
  const patched = await fetch(`${base}/api/books/auto-book`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ completedStages: [], title: "自动之书 2" }) });
  assert.equal(patched.status, 200);
  assert.deepEqual((await patched.json()).book.completedStages, ["world", "characters", "story", "outline"]);
});

test("作者可以修改生成的资料 Markdown，原始 JSON 保持只读", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "myflow-material-api-"));
  const server = await startServer({ port: 0, dataRoot: root });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${base}/api/books`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "editable-book", title: "资料", premise: "一座城。", genre: "科幻", style: "克制", length: "长篇", chapterWords: "2500" }) });
  await fetch(`${base}/api/books/editable-book/workflow/world`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const fileUrl = `${base}/api/books/editable-book/files/meta%2Fworld_foundation.md`;
  const saved = await fetch(fileUrl, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "# 作者改写的世界\n" }) });
  assert.equal(saved.status, 200);
  assert.match((await (await fetch(fileUrl)).json()).content, /作者改写的世界/);
  const readonly = await fetch(`${base}/api/books/editable-book/files/world%2Ffoundation.json`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "{}" }) });
  assert.equal(readonly.status, 403);
});
