const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

export const MODEL_PROVIDERS = [
  { key: "openai-compatible", label: "OpenAI 兼容接口", baseUrl: "https://api.openai.com/v1" },
  { key: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { key: "ollama", label: "Ollama 本地", baseUrl: "http://127.0.0.1:11434/v1" },
  { key: "siliconflow", label: "硅基流动", baseUrl: "https://api.siliconflow.cn/v1" },
  { key: "custom", label: "自定义兼容接口", baseUrl: "" },
];

export const DEFAULT_MODEL_SETTINGS = {
  provider: "openai-compatible",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiKey: "",
  temperature: 0.7,
  maxTokens: 4096,
  updatedAt: null,
};

const providerKeys = new Set(MODEL_PROVIDERS.map((provider) => provider.key));

export class ModelSettingsError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ModelSettingsError";
    this.status = status;
  }
}

function requiredText(value, field, maxLength) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ModelSettingsError(`${field}不能为空`, 400);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new ModelSettingsError(`${field}过长`, 400);
  return normalized;
}

function normalizeBaseUrl(value) {
  const raw = requiredText(value, "接口地址", 500).replace(/\/+$/u, "");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ModelSettingsError("接口地址必须是完整 URL", 400);
  }
  if (!HTTP_PROTOCOLS.has(parsed.protocol) || parsed.username || parsed.password) {
    throw new ModelSettingsError("接口地址只支持 http 或 https，且不能包含账号密码", 400);
  }
  return parsed.toString().replace(/\/+$/u, "");
}

function normalizeNumber(value, field, min, max, integer = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    throw new ModelSettingsError(`${field}必须在 ${min} 到 ${max} 之间`, 400);
  }
  return number;
}

export function normalizeModelSettings(input = {}, current = DEFAULT_MODEL_SETTINGS) {
  const data = input && typeof input === "object" ? input : {};
  const base = { ...DEFAULT_MODEL_SETTINGS, ...current };
  const provider = data.provider === undefined ? base.provider : String(data.provider).trim();
  if (!providerKeys.has(provider)) throw new ModelSettingsError("模型服务商无效", 400);
  const model = requiredText(data.model === undefined ? base.model : String(data.model), "模型名称", 200);
  const apiKey = data.clearApiKey
    ? ""
    : data.apiKey === undefined || data.apiKey === ""
      ? String(base.apiKey || "")
      : requiredText(String(data.apiKey), "API Key", 500);
  if (apiKey.length > 500) throw new ModelSettingsError("API Key过长", 400);
  return {
    provider,
    baseUrl: normalizeBaseUrl(data.baseUrl === undefined ? base.baseUrl : String(data.baseUrl)),
    model,
    apiKey,
    temperature: normalizeNumber(data.temperature === undefined ? base.temperature : data.temperature, "温度", 0, 2),
    maxTokens: normalizeNumber(data.maxTokens === undefined ? base.maxTokens : data.maxTokens, "最大输出", 256, 32768, true),
    updatedAt: base.updatedAt || null,
  };
}

function maskApiKey(apiKey) {
  if (!apiKey) return "";
  if (apiKey.length <= 8) return "已配置";
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

export function publicModelSettings(settings) {
  const normalized = normalizeModelSettings(settings);
  const provider = MODEL_PROVIDERS.find((item) => item.key === normalized.provider);
  return {
    provider: normalized.provider,
    providerLabel: provider?.label || normalized.provider,
    baseUrl: normalized.baseUrl,
    model: normalized.model,
    temperature: normalized.temperature,
    maxTokens: normalized.maxTokens,
    apiKeyConfigured: Boolean(normalized.apiKey),
    apiKeyPreview: maskApiKey(normalized.apiKey),
    updatedAt: normalized.updatedAt,
  };
}

export async function testModelConnection(settings, fetchImpl = fetch) {
  const normalized = normalizeModelSettings(settings);
  const headers = { accept: "application/json" };
  if (normalized.apiKey) headers.authorization = `Bearer ${normalized.apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(`${normalized.baseUrl}/models`, { headers, signal: controller.signal });
    const body = await response.text();
    if (!response.ok) throw new ModelSettingsError(`模型接口返回 HTTP ${response.status}`, 502);
    let payload = {};
    try { payload = body ? JSON.parse(body) : {}; } catch { /* Some gateways return an empty success body. */ }
    const models = Array.isArray(payload.data) ? payload.data.map((item) => item?.id).filter(Boolean).slice(0, 20) : [];
    return {
      ok: true,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      model: normalized.model,
      modelAvailable: models.length === 0 || models.includes(normalized.model),
      models,
      summary: `连接成功，耗时 ${Date.now() - startedAt} ms。`,
    };
  } catch (error) {
    if (error instanceof ModelSettingsError) throw error;
    if (error?.name === "AbortError") throw new ModelSettingsError("模型接口连接超时", 504);
    throw new ModelSettingsError(`模型接口连接失败：${error.message || "网络错误"}`, 502);
  } finally {
    clearTimeout(timer);
  }
}
