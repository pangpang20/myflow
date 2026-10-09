import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BookStorage, StorageError, assertBookSlug } from "../app/storage.mjs";

async function tempStorage() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "myflow-storage-"));
  return { root, storage: new BookStorage(root) };
}

test("书籍创建会建立可迁移的本地存档目录", async () => {
  const { root, storage } = await tempStorage();
  const book = await storage.createBook({
    slug: "echo-zone",
    title: "回声区",
    premise: "一个城市开始记得尚未发生的事。",
    genre: "科幻",
    style: "克制、悬疑",
    length: "中篇",
    chapterWords: "2500",
    mode: "review",
  });
  assert.equal(book.stage, "premise");
  assert.deepEqual(await storage.listBooks(), [book]);
  for (const name of ["meta", "world", "outline", "story", "archive", "cache"]) {
    const stat = await fs.stat(path.join(root, "books", "echo-zone", name));
    assert.equal(stat.isDirectory(), true);
  }
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, "books", "echo-zone", "book.json"))), book);
});

test("更新和删除只作用于指定书籍", async () => {
  const { storage } = await tempStorage();
  await storage.createBook({ slug: "one", title: "一", premise: "a", genre: "b", style: "c", length: "d", chapterWords: "2000" });
  await storage.createBook({ slug: "two", title: "二", premise: "a", genre: "b", style: "c", length: "d", chapterWords: "2000" });
  const updated = await storage.updateBook("one", { title: "一号作品", mode: "auto" });
  assert.equal(updated.title, "一号作品");
  assert.equal((await storage.getBook("two")).title, "二");
  await storage.deleteBook("one");
  assert.equal((await storage.listBooks()).length, 1);
});

test("拒绝路径穿越和非法书籍标识", async () => {
  assert.throws(() => assertBookSlug("../outside"), StorageError);
  const { storage } = await tempStorage();
  await assert.rejects(() => storage.getBook("../../outside"), (error) => error.status === 400);
});

