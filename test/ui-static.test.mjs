import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startServer } from "../app/server.mjs";

test("本地控制台静态入口包含书架、阶段和正文工作台", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "myflow-ui-"));
  const server = await startServer({ port: 0, dataRoot: root });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /LOCAL NOVELBUILT/);
  assert.match(html, /新建作品/);
  assert.match(html, /导出 Markdown/);
  assert.match(html, /导出 TXT/);
  assert.match(html, /book-template/);

  const styles = await fetch(`${base}/styles.css`);
  assert.equal(styles.status, 200);
  assert.match(await styles.text(), /--paper: #fefcf8/);

  const script = await fetch(`${base}/app.js`);
  assert.equal(script.status, 200);
  const source = await script.text();
  assert.match(source, /\/chapters\//);
  assert.match(source, /downloadExport/);
  assert.match(source, /performChapterAction/);
});
