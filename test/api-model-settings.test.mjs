import assert from "node:assert/strict";
import http from "node:http";
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
  return { response, body: await response.json() };
}

test("模型配置 API 持久化设置并脱敏返回密钥", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "myflow-model-settings-"));
  const server = await startServer({ port: 0, dataRoot: root });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const initial = await jsonRequest(base, "/api/settings/model");
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.settings.apiKeyConfigured, false);
  assert.ok(initial.body.providers.some((provider) => provider.key === "deepseek"));

  const saved = await jsonRequest(base, "/api/settings/model", {
    method: "PUT",
    body: JSON.stringify({ provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKey: "sk-local-secret", temperature: 0.2, maxTokens: 4096 }),
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.settings.apiKeyConfigured, true);
  assert.equal(saved.body.settings.apiKeyPreview, "sk-l...cret");
  assert.equal("apiKey" in saved.body.settings, false);

  const reloaded = await jsonRequest(base, "/api/settings/model");
  assert.equal(reloaded.body.settings.model, "deepseek-chat");
  assert.equal(reloaded.body.settings.apiKeyPreview, "sk-l...cret");

  const cleared = await jsonRequest(base, "/api/settings/model", {
    method: "PUT",
    body: JSON.stringify({ clearApiKey: true }),
  });
  assert.equal(cleared.body.settings.apiKeyConfigured, false);

  const invalid = await jsonRequest(base, "/api/settings/model", {
    method: "PUT",
    body: JSON.stringify({ baseUrl: "file:///not-allowed" }),
  });
  assert.equal(invalid.response.status, 400);
});

test("模型连接测试调用 OpenAI 兼容的 models 接口", async (t) => {
  let authorization = "";
  const upstream = http.createServer((request, response) => {
    authorization = request.headers.authorization || "";
    assert.equal(request.url, "/v1/models");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "local-model" }] }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => upstream.close());

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "myflow-model-test-"));
  const server = await startServer({ port: 0, dataRoot: root });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const upstreamBase = `http://127.0.0.1:${upstream.address().port}/v1`;
  const result = await jsonRequest(base, "/api/settings/model/test", {
    method: "POST",
    body: JSON.stringify({ provider: "custom", baseUrl: upstreamBase, model: "local-model", apiKey: "local-secret", temperature: 0.7, maxTokens: 1024 }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.modelAvailable, true);
  assert.equal(authorization, "Bearer local-secret");
});
