import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BookStorage } from "../app/storage.mjs";
import { preparationState, runPreparationSequence, runPreparationStage } from "../app/generation.mjs";

async function makeBook() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "myflow-workflow-"));
  const storage = new BookStorage(root);
  await storage.createBook({ slug: "workflow-book", title: "工作流之书", premise: "一份记录改变一座城。", genre: "悬疑", style: "克制", length: "长篇", chapterWords: "3000" });
  return storage;
}

test("建书四阶段必须按顺序完成并落盘", async () => {
  const storage = await makeBook();
  assert.equal(preparationState(await storage.getBook("workflow-book"))[0].status, "ready");
  assert.equal(preparationState(await storage.getBook("workflow-book"))[1].status, "locked");
  await assert.rejects(() => runPreparationStage(storage, "workflow-book", "outline"), (error) => error.status === 409);
  for (const stage of ["world", "characters", "story", "outline"]) {
    const result = await runPreparationStage(storage, "workflow-book", stage);
    assert.equal(result.run.mode, "mock");
    assert.equal(result.run.status, "completed");
    assert.ok(result.artifacts.length > 0);
  }
  const book = await storage.getBook("workflow-book");
  assert.deepEqual(book.completedStages, ["world", "characters", "story", "outline"]);
  assert.match(await storage.readBookText("workflow-book", "outline/volume_outline.md"), /潮雾中的空白/);
});

test("阶段文件读取拒绝越界路径", async () => {
  const storage = await makeBook();
  await assert.rejects(() => storage.readBookText("workflow-book", "../book.json"), (error) => error.status === 400);
});

test("自动推进完成所有前置阶段且重复运行不会覆盖成果", async () => {
  const storage = await makeBook();
  const first = await runPreparationSequence(storage, "workflow-book");
  assert.equal(first.runs.length, 4);
  assert.deepEqual(first.book.completedStages, ["world", "characters", "story", "outline"]);
  const second = await runPreparationSequence(storage, "workflow-book");
  assert.equal(second.runs.length, 0);
});
