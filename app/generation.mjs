import { StorageError } from "./storage.mjs";

export const PREPARATION_STAGES = [
  { key: "world", label: "世界观", workflowId: "bishu-novel-build", prerequisite: null },
  { key: "characters", label: "角色表", workflowId: "bishu-novel-character", prerequisite: "world" },
  { key: "story", label: "故事规划", workflowId: "bishu-novel-story-plan", prerequisite: "characters" },
  { key: "outline", label: "卷大纲", workflowId: "bishu-novel-outline", prerequisite: "story" },
];

const stageByKey = new Map(PREPARATION_STAGES.map((stage) => [stage.key, stage]));

export class GenerationError extends StorageError {
  constructor(message, status = 409) {
    super(message, status);
    this.name = "GenerationError";
  }
}

export function getPreparationStage(key) {
  const stage = stageByKey.get(key);
  if (!stage) throw new GenerationError("未知的创作阶段", 404);
  return stage;
}

function shortPremise(book) {
  return book.premise.length > 120 ? `${book.premise.slice(0, 117)}...` : book.premise;
}

export class MockGenerationEngine {
  mode = "mock";

  run(stageKey, book, input = {}) {
    const premise = String(input.premise || book.premise).trim();
    const title = book.title;
    switch (stageKey) {
      case "world":
        return {
          files: {
            "world/foundation.json": JSON.stringify({
              title,
              premise,
              laws: ["因果会留下可追溯的回声", "重要选择必须支付代价"],
              geography: "故事从一座被潮雾包围的旧城开始。",
              society: "城市由守序的档案院与自由的拾荒者共同维持。",
              history: "二十年前的沉默事故改变了人们记录时间的方式。",
              existence: "记忆可以被保存，但不能被凭空创造。",
              information: "真相通过碎片化的私人记录逐步显形。",
            }, null, 2),
            "meta/world_foundation.md": `# ${title} · 世界观基础\n\n${premise}\n\n## 核心法则\n\n- 因果会留下可追溯的回声。\n- 重要选择必须支付代价。\n\n## 时空地理\n\n故事从一座被潮雾包围的旧城开始。\n`,
          },
          summary: "六个维度已建立，世界可以进入角色设计。",
        };
      case "characters":
        return {
          files: {
            "meta/characters.json": JSON.stringify({
              characters: [
                { name: "沈砚", role: "记录员", desire: "找回被删去的一段时间", voice: "短句，少解释，多观察" },
                { name: "林照", role: "拾荒者", desire: "证明沉默事故并非意外", voice: "直接，偶尔用旧城俚语" },
              ],
            }, null, 2),
            "meta/character_profiles.md": `# ${title} · 角色表\n\n## 沈砚\n\n记录员。想找回被删去的一段时间。\n\n## 林照\n\n拾荒者。想证明沉默事故并非意外。\n`,
          },
          summary: "主角和关键关系已建立，故事规划可以引用角色动机。",
        };
      case "story":
        return {
          files: {
            "meta/story_plan.json": JSON.stringify({
              premise: shortPremise(book),
              engine: "寻找被删去的时间，同时承担揭开真相的代价。",
              promise: "每次接近真相，主角都必须放弃一段私人记忆。",
              constraints: ["线索必须来自可验证的记录", "角色选择改变关系而非只改变信息"],
            }, null, 2),
            "meta/story_plan.md": `# ${title} · 故事规划\n\n## 故事引擎\n\n寻找被删去的时间，同时承担揭开真相的代价。\n\n## 读者承诺\n\n每次接近真相，主角都必须放弃一段私人记忆。\n`,
          },
          summary: "故事引擎、读者承诺和约束已明确。",
        };
      case "outline":
        return {
          files: {
            "outline/volume_001.json": JSON.stringify({
              volume: 1,
              title: "潮雾中的空白",
              chapters: [
                { number: 1, title: "没有日期的记录", summary: "沈砚发现一份写着自己笔迹却没有日期的档案。" },
                { number: 2, title: "拾荒者的条件", summary: "林照提出交换条件，要求沈砚承认沉默事故存在。" },
                { number: 3, title: "潮线退去之前", summary: "两人进入旧档案院，第一次看见被删去的城市地图。" },
              ],
            }, null, 2),
            "outline/volume_outline.md": `# 第一卷 · 潮雾中的空白\n\n1. 没有日期的记录\n2. 拾荒者的条件\n3. 潮线退去之前\n`,
            "outline/near_term_outline.md": "# 近期细纲\n\n第一章从一份没有日期的旧记录开始，结尾留下与主角笔迹相同的警告。\n",
          },
          summary: "第一卷和近期细纲已生成，可以进入工作台写第一章。",
        };
      default:
        throw new GenerationError("该阶段暂不支持模拟生成", 400);
    }
  }
}

export async function runPreparationStage(storage, slug, stageKey, input = {}, engine = new MockGenerationEngine()) {
  const stage = getPreparationStage(stageKey);
  const book = await storage.getBook(slug);
  const completed = new Set(book.completedStages || []);
  if (stage.prerequisite && !completed.has(stage.prerequisite)) {
    throw new GenerationError(`请先完成${stageByKey.get(stage.prerequisite).label}`, 409);
  }
  const startedAt = new Date().toISOString();
  const result = engine.run(stage.key, book, input);
  const artifacts = [];
  for (const [relativePath, content] of Object.entries(result.files)) {
    artifacts.push(await storage.writeBookText(slug, relativePath, `${content}\n`));
  }
  completed.add(stage.key);
  const updated = await storage.setBookProgress(slug, stage.key, [...completed]);
  return {
    run: {
      id: `mock-${Date.now().toString(36)}`,
      mode: engine.mode,
      workflowId: stage.workflowId,
      stage: stage.key,
      status: "completed",
      startedAt,
      completedAt: new Date().toISOString(),
    },
    book: updated,
    artifacts,
    summary: result.summary,
  };
}

export async function runPreparationSequence(storage, slug, engine = new MockGenerationEngine()) {
  const results = [];
  for (const stage of PREPARATION_STAGES) {
    const book = await storage.getBook(slug);
    if ((book.completedStages || []).includes(stage.key)) continue;
    results.push(await runPreparationStage(storage, slug, stage.key, {}, engine));
  }
  return { book: await storage.getBook(slug), runs: results.map((result) => result.run) };
}

export function preparationState(book) {
  const completed = new Set(book.completedStages || []);
  return PREPARATION_STAGES.map((stage) => ({
    ...stage,
    status: completed.has(stage.key) ? "completed" : stage.prerequisite && !completed.has(stage.prerequisite) ? "locked" : "ready",
  }));
}
