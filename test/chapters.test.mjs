import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BookStorage } from "../app/storage.mjs";
import {
  exportChapters,
  finalizeChapter,
  getChapter,
  listChapterVersions,
  polishChapter,
  regenerateChapter,
  restoreChapterVersion,
  rewriteSelection,
  runChapterGeneration,
  saveChapter,
} from "../app/chapters.mjs";
import { runPreparationStage } from "../app/generation.mjs";

async function makeReadyBook() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "myflow-chapters-"));
  const storage = new BookStorage(root);
  await storage.createBook({
    slug: "chapter-book",
    title: "章节之书",
    premise: "一份记录改变一座城。",
    genre: "悬疑",
    style: "克制",
    length: "长篇",
    chapterWords: "3000",
  });
  for (const stage of ["world", "characters", "story", "outline"]) {
    await runPreparationStage(storage, "chapter-book", stage);
  }
  return { root, storage };
}

test("章节生产支持编辑、版本恢复、润色、后验和导出", async () => {
  const { root, storage } = await makeReadyBook();
  const generated = await runChapterGeneration(storage, "chapter-book", "1", {
    guidance: "让沈砚先发现铜片。",
    worldIntervention: "潮线提前退去。",
  });
  assert.equal(generated.chapter.number, "0001");
  assert.match(generated.content, /先发现铜片/);

  const edited = await saveChapter(storage, "chapter-book", "0001", {
    content: `${generated.content}\n\n这是作者手写的收束。`,
  });
  assert.ok(edited.versionId);
  const versions = await listChapterVersions(storage, "chapter-book", "1");
  assert.equal(versions.length, 1);
  assert.equal(versions[0].source, "edit-before");

  const polished = await polishChapter(storage, "chapter-book", "0001");
  assert.ok(polished.versionId);
  assert.match(polished.content, /作者手写的收束。/);

  const restored = await restoreChapterVersion(storage, "chapter-book", "0001", edited.versionId);
  assert.equal(restored.content, generated.content);

  const regenerated = await regenerateChapter(storage, "chapter-book", "0001", { writerType: "ensemble" });
  assert.equal(regenerated.chapter.writerType, "ensemble");
  const finalized = await finalizeChapter(storage, "chapter-book", "0001");
  assert.equal(finalized.chapter.status, "finalized");
  assert.equal(finalized.postHoc.status, "completed");

  const reloaded = new BookStorage(root);
  const chapter = await getChapter(reloaded, "chapter-book", "0001");
  assert.equal(chapter.chapter.status, "finalized");
  assert.ok(chapter.versions.length >= 4);

  const markdown = await exportChapters(reloaded, "chapter-book", { format: "md" });
  assert.equal(markdown.filename, "chapter-book.md");
  assert.match(markdown.content, /# 章节之书/);
  assert.match(markdown.content, /## 第0001章/);
  const text = await exportChapters(reloaded, "chapter-book", { format: "txt" });
  assert.match(text.content, /^章节之书\n\n第0001章/m);
});

test("章节模块拒绝未完成建书流程和非法导出范围", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "myflow-chapters-locked-"));
  const storage = new BookStorage(root);
  await storage.createBook({ slug: "locked-book", title: "未就位", premise: "a", genre: "b", style: "c", length: "d", chapterWords: "2000" });
  await assert.rejects(
    () => runChapterGeneration(storage, "locked-book", "0001"),
    (error) => error.status === 409,
  );
  for (const stage of ["world", "characters", "story", "outline"]) {
    await runPreparationStage(storage, "locked-book", stage);
  }
  await runChapterGeneration(storage, "locked-book", "0001");
  await assert.rejects(
    () => exportChapters(storage, "locked-book", { format: "pdf" }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    () => exportChapters(storage, "locked-book", { from: "0002", to: "0001" }),
    (error) => error.status === 400,
  );
});

test("选段改写只替换选区、保存旧版本并撤销过期后验", async () => {
  const { root, storage } = await makeReadyBook();
  await runChapterGeneration(storage, "chapter-book", "0001");
  const original = "序幕。沈砚发现密信。结尾。";
  await saveChapter(storage, "chapter-book", "0001", { content: original });
  await finalizeChapter(storage, "chapter-book", "0001");
  const selectionText = "沈砚发现密信。";
  const start = original.indexOf(selectionText);
  const result = await rewriteSelection(storage, "chapter-book", "0001", {
    start,
    end: start + selectionText.length,
    original: selectionText,
    instruction: "让动作更紧张",
  });

  assert.equal(result.content, "序幕。沈砚发现密信，让动作更紧张。结尾。");
  assert.equal(result.selection.original, selectionText);
  assert.equal(result.selection.replacement, "沈砚发现密信，让动作更紧张。");
  assert.equal(result.selection.end, start + result.selection.replacement.length);
  assert.equal(result.chapter.status, "draft");
  assert.equal(result.chapter.finalizedAt, undefined);
  assert.equal(result.chapter.postHocPath, undefined);
  assert.ok(result.versionId);
  assert.equal((await listChapterVersions(storage, "chapter-book", "0001"))[0].source, "rewrite-before");
  await assert.rejects(
    () => fs.access(path.join(root, "books", "chapter-book", "story", "0001", "post-hoc.json")),
    (error) => error.code === "ENOENT",
  );
  const reloaded = await getChapter(new BookStorage(root), "chapter-book", "0001");
  assert.equal(reloaded.content, result.content);
  const restored = await restoreChapterVersion(storage, "chapter-book", "0001", result.versionId);
  assert.equal(restored.content, original);
});

test("选段改写拒绝无效偏移、空白选区和缺失指令", async () => {
  const { storage } = await makeReadyBook();
  await runChapterGeneration(storage, "chapter-book", "0001");
  await saveChapter(storage, "chapter-book", "0001", { content: "开端。\n\n结尾。" });
  const before = await listChapterVersions(storage, "chapter-book", "0001");
  for (const input of [
    { start: 0, end: 0, instruction: "加快节奏" },
    { start: -1, end: 2, instruction: "加快节奏" },
    { start: 0.5, end: 2, instruction: "加快节奏" },
    { start: 0, end: 100, instruction: "加快节奏" },
    { start: 3, end: 5, instruction: "加快节奏" },
    { start: 0, end: 2, instruction: "" },
  ]) {
    await assert.rejects(
      () => rewriteSelection(storage, "chapter-book", "0001", input),
      (error) => error.status === 400,
    );
  }
  assert.equal((await listChapterVersions(storage, "chapter-book", "0001")).length, before.length);
  assert.equal((await getChapter(storage, "chapter-book", "0001")).content, "开端。\n\n结尾。");
});

test("选段改写拒绝已经变化的正文选区", async () => {
  const { storage } = await makeReadyBook();
  await runChapterGeneration(storage, "chapter-book", "0001");
  await saveChapter(storage, "chapter-book", "0001", { content: "开端。旧线索。结尾。" });
  const before = await listChapterVersions(storage, "chapter-book", "0001");
  await assert.rejects(
    () => rewriteSelection(storage, "chapter-book", "0001", {
      start: 3, end: 7, original: "新线索。", instruction: "写得更紧张",
    }),
    (error) => error.status === 409,
  );
  assert.equal((await getChapter(storage, "chapter-book", "0001")).content, "开端。旧线索。结尾。");
  assert.equal((await listChapterVersions(storage, "chapter-book", "0001")).length, before.length);
});
