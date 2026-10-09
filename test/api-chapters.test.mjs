import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startServer } from "../app/server.mjs";

async function post(base, pathname, body = {}) {
  return fetch(`${base}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("章节 HTTP API 跑通生成、编辑、恢复、定稿和导出", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "myflow-api-chapters-"));
  const server = await startServer({ port: 0, dataRoot: root });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const book = {
    slug: "api-chapters",
    title: "章节接口",
    premise: "接口也要保存故事。",
    genre: "科幻",
    style: "清醒",
    length: "中篇",
    chapterWords: "2500",
  };
  await fetch(`${base}/api/books`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(book),
  });
  for (const stage of ["world", "characters", "story", "outline"]) {
    const response = await post(base, `/api/books/${book.slug}/workflow/${stage}`);
    assert.equal(response.status, 200);
  }

  const generatedResponse = await post(base, `/api/books/${book.slug}/chapters/0001/generate`, {
    guidance: "让线索在结尾反转。",
  });
  assert.equal(generatedResponse.status, 200);
  const generated = await generatedResponse.json();
  assert.equal(generated.chapter.number, "0001");

  const savedResponse = await fetch(`${base}/api/books/${book.slug}/chapters/0001`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: `${generated.content}\n\n接口编辑。` }),
  });
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.ok(saved.versionId);

  const versionsResponse = await fetch(`${base}/api/books/${book.slug}/chapters/0001/versions`);
  assert.equal(versionsResponse.status, 200);
  assert.equal((await versionsResponse.json()).versions.length, 1);

  const restoredResponse = await post(base, `/api/books/${book.slug}/chapters/0001/restore`, { versionId: saved.versionId });
  assert.equal(restoredResponse.status, 200);
  assert.match((await restoredResponse.json()).content, /线索在结尾反转/);

  const finalizedResponse = await post(base, `/api/books/${book.slug}/chapters/0001/post-hoc`);
  assert.equal(finalizedResponse.status, 200);
  assert.equal((await finalizedResponse.json()).chapter.status, "finalized");

  const chaptersResponse = await fetch(`${base}/api/books/${book.slug}/chapters`);
  assert.deepEqual((await chaptersResponse.json()).chapters.map((chapter) => chapter.number), ["0001"]);
  const exportResponse = await fetch(`${base}/api/books/${book.slug}/export?format=txt`);
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("content-disposition"), /api-chapters\.txt/);
  assert.match(await exportResponse.text(), /章节接口/);
});

test("章节 API 返回明确的路径和格式错误", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "myflow-api-chapters-errors-"));
  const server = await startServer({ port: 0, dataRoot: root });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/books/missing/chapters/../export?format=pdf`);
  assert.ok([400, 404].includes(response.status));
});

test("章节 HTTP API 支持选段改写并保留可恢复版本", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "myflow-api-rewrite-"));
  const server = await startServer({ port: 0, dataRoot: root });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const book = {
    slug: "api-rewrite",
    title: "选段改写接口",
    premise: "一句话也要能重写。",
    genre: "悬疑",
    style: "克制",
    length: "中篇",
    chapterWords: "2500",
  };
  await fetch(`${base}/api/books`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(book),
  });
  for (const stage of ["world", "characters", "story", "outline"]) {
    assert.equal((await post(base, `/api/books/${book.slug}/workflow/${stage}`)).status, 200);
  }
  assert.equal((await post(base, `/api/books/${book.slug}/chapters/0001/generate`)).status, 200);
  const original = "开头。沈砚推开门。结尾。";
  assert.equal((await fetch(`${base}/api/books/${book.slug}/chapters/0001`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: original }),
  })).status, 200);

  const selected = "沈砚推开门。";
  const start = original.indexOf(selected);
  const rewrittenResponse = await post(base, `/api/books/${book.slug}/chapters/0001/rewrite`, {
    start,
    end: start + selected.length,
    original: selected,
    instruction: "让动作更紧张",
  });
  assert.equal(rewrittenResponse.status, 200);
  const rewritten = await rewrittenResponse.json();
  assert.equal(rewritten.content, "开头。沈砚推开门，让动作更紧张。结尾。");
  assert.equal(rewritten.selection.original, selected);
  assert.ok(rewritten.versionId);

  const staleResponse = await post(base, `/api/books/${book.slug}/chapters/0001/rewrite`, {
    start, end: start + selected.length, original: selected, instruction: "再次改写",
  });
  assert.equal(staleResponse.status, 409);
  assert.equal((await (await fetch(`${base}/api/books/${book.slug}/chapters/0001`)).json()).content, rewritten.content);

  const restoredResponse = await post(base, `/api/books/${book.slug}/chapters/0001/restore`, { versionId: rewritten.versionId });
  assert.equal(restoredResponse.status, 200);
  assert.equal((await restoredResponse.json()).content, original);
});
