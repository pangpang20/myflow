import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MODEL_SETTINGS, ModelSettingsError, normalizeModelSettings, publicModelSettings } from "../app/model-settings.mjs";

test("模型配置规范化并且不会在公开配置中暴露密钥", () => {
  const settings = normalizeModelSettings({
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1/",
    model: "deepseek-chat",
    apiKey: "sk-test-secret-1234",
    temperature: "0.4",
    maxTokens: "2048",
  });
  assert.equal(settings.baseUrl, "https://api.deepseek.com/v1");
  assert.equal(publicModelSettings(settings).apiKeyPreview, "sk-t...1234");
  assert.equal("apiKey" in publicModelSettings(settings), false);
});

test("模型配置拒绝不安全地址和越界参数", () => {
  for (const input of [
    { baseUrl: "file:///tmp/model" },
    { baseUrl: "https://user:pass@example.com/v1" },
    { baseUrl: "https://example.com/v1", temperature: 3 },
    { baseUrl: "https://example.com/v1", maxTokens: 128 },
  ]) {
    assert.throws(() => normalizeModelSettings(input, { ...DEFAULT_MODEL_SETTINGS }), ModelSettingsError);
  }
});

test("留空 API Key 会保留原配置，显式清除才会移除", () => {
  const current = { ...DEFAULT_MODEL_SETTINGS, apiKey: "sk-existing" };
  assert.equal(normalizeModelSettings({ apiKey: "" }, current).apiKey, "sk-existing");
  assert.equal(normalizeModelSettings({ clearApiKey: true }, current).apiKey, "");
});
