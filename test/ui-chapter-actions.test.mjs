import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(path.join(process.cwd(), "app", "public", "app.js"), "utf8");

function makeChapterUi(content, selectionStart, selectionEnd, instruction = "让动作更紧张") {
  const calls = [];
  const editor = { value: content, selectionStart, selectionEnd };
  const nodes = {
    "#app": {},
    "#breadcrumb": {},
    "#toast": { classList: { add() {}, remove() {} } },
    "#chapter-title-edit": { value: "第一章" },
    "#chapter-content-edit": editor,
    "#rewrite-instruction": { value: instruction },
  };
  const context = vm.createContext({
    document: {
      querySelector: (selector) => nodes[selector],
      addEventListener() {},
    },
    fetch: async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET", body: options.body });
      const payload = url.endsWith("/chapters") ? { chapters: [] }
        : url.endsWith("/chapters/0001") && !options.method
          ? { chapter: { title: "第一章" }, content, versions: [] }
          : { summary: "完成" };
      return { ok: true, json: async () => payload };
    },
    clearTimeout() {},
    setTimeout: () => 0,
  });
  vm.runInContext(source.replace(/\bboot\(\);\s*$/, ""), context);
  vm.runInContext(`state.currentBook = { slug: "chapter-book" };
    state.currentChapter = { chapter: { title: "第一章" }, content: "旧正文。" };
    renderBook = () => {};`, context);
  return { calls, context };
}

test("选段改写会先保存未保存正文，再发送与新正文匹配的选区", async () => {
  const content = "新开头。旧正文。结尾。";
  const original = "旧正文。";
  const start = content.indexOf(original);
  const { calls, context } = makeChapterUi(content, start, start + original.length);
  await vm.runInContext('performChapterAction("rewrite", "0001")', context);

  assert.deepEqual(calls.slice(0, 2).map(({ method }) => method), ["PUT", "POST"]);
  assert.equal(JSON.parse(calls[0].body).content, content);
  assert.equal(calls[1].url, "/api/books/chapter-book/chapters/0001/rewrite");
  assert.deepEqual(JSON.parse(calls[1].body), {
    start, end: start + original.length, original, instruction: "让动作更紧张",
  });
});

test("无选区时不会保存或改写正文", async () => {
  const { calls, context } = makeChapterUi("新开头。旧正文。", 0, 0);
  await vm.runInContext('performChapterAction("rewrite", "0001")', context);
  assert.equal(calls.length, 0);
});
