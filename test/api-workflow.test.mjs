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

