import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { StorageError } from "./storage.mjs";

const CHAPTER_NUMBER = /^\d{1,6}$/;
const VERSION_ID = /^[a-f0-9-]{8,80}$/i;
const MAX_CONTENT_LENGTH = 500_000;

export class ChapterError extends StorageError {
  constructor(message, status = 409) {
    super(message, status);
    this.name = "ChapterError";
  }
}

export function normalizeChapterNumber(value) {
  const raw = String(value ?? "").trim();
  if (!CHAPTER_NUMBER.test(raw)) {
    throw new ChapterError("章节号必须是 1 至 6 位数字", 400);
  }
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 1 || number > 999999) {
    throw new ChapterError("章节号必须在 0001 至 999999 之间", 400);
  }
  return raw.padStart(4, "0");
}

function requiredText(value, field, maxLength = MAX_CONTENT_LENGTH) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ChapterError(`${field}不能为空`, 400);
  }
  if (value.length > maxLength) {
    throw new ChapterError(`${field}过长`, 400);
  }
  return value.trim();
}

function optionalText(value, field, maxLength) {
  if (value === undefined || value === null || value === "") return "";
  return requiredText(value, field, maxLength);
}

function wordCount(content) {
  return String(content).replace(/\s/g, "").length;
}

function chapterDirectory(storage, slug, chapterNumber) {
  const number = normalizeChapterNumber(chapterNumber);
  return {
    number,
    root: path.join(storage.bookDir(slug), "story", number),
  };
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) throw new ChapterError("章节存档损坏", 500);
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadChapter(storage, slug, chapterNumber) {
  const { number, root } = chapterDirectory(storage, slug, chapterNumber);
  const metadata = await readJson(path.join(root, "chapter.json"));
  if (!metadata) return null;
  let content;
  try {
    content = await fs.readFile(path.join(root, "chapter.md"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new ChapterError("章节正文不存在", 500);
    throw error;
  }
  return {
    ...metadata,
    number,
    content: content.replace(/\n$/, ""),
  };
}

async function requireChapter(storage, slug, chapterNumber) {
  const chapter = await loadChapter(storage, slug, chapterNumber);
  if (!chapter) throw new ChapterError("章节不存在", 404);
  return chapter;
}

async function writeCurrentChapter(storage, slug, chapter) {
  const { root } = chapterDirectory(storage, slug, chapter.number);
  await fs.mkdir(root, { recursive: true });
  const metadata = { ...chapter };
  delete metadata.content;
  await fs.writeFile(path.join(root, "chapter.md"), `${chapter.content.trim()}\n`, "utf8");
  await writeJson(path.join(root, "chapter.json"), metadata);
  return metadata;
}

async function clearPostHoc(storage, slug, chapterNumber) {
  const { root } = chapterDirectory(storage, slug, chapterNumber);
  await fs.rm(path.join(root, "post-hoc.json"), { force: true });
}

async function createVersion(storage, slug, chapter, source) {
  const { root } = chapterDirectory(storage, slug, chapter.number);
  const version = {
    id: randomUUID(),
    chapterNumber: chapter.number,
    title: chapter.title,
    content: chapter.content,
    wordCount: wordCount(chapter.content),
    source,
    createdAt: new Date().toISOString(),
  };
  await writeJson(path.join(root, "versions", `${version.id}.json`), version);
  return version;
}

async function assertPreparationReady(storage, slug) {
  const book = await storage.getBook(slug);
  if (!new Set(book.completedStages || []).has("outline")) {
    throw new ChapterError("请先完成卷大纲，再进入章节生产", 409);
  }
  return book;
}

function previousChapterSummary(chapterNumber, chapters) {
  const previousNumber = String(Number(chapterNumber) - 1).padStart(4, "0");
  return chapters.find((chapter) => chapter.number === previousNumber) || null;
}

export class MockChapterGenerationEngine {
  mode = "mock";

  generate(book, chapterNumber, input = {}, context = {}) {
    const number = normalizeChapterNumber(chapterNumber);
    const guidance = optionalText(input.guidance, "本章指导", 20_000) || "沿着近期细纲推进线索，让角色做出一次不可逆的选择。";
    const worldIntervention = optionalText(input.worldIntervention, "世界干预", 20_000);
    const writerType = input.writerType === "ensemble" ? "ensemble" : "single";
    const targetWordCount = optionalText(input.targetWordCount, "目标字数", 40) || book.chapterWords;
    const previous = context.previous;
    const title = optionalText(input.title, "章节标题", 200) || `第${number}章 · 没有日期的记录`;
    const previousLine = previous
      ? `上一章留下的线索仍在发热：${previous.title}。`
      : "旧档案室的钟停在一个没有日期的时刻。";
    const interventionLine = worldIntervention
      ? `世界干预：${worldIntervention}`
      : "潮雾把街道切成几段，远处的灯一盏接一盏熄灭。";
    const modeLine = writerType === "ensemble"
      ? "几种不同的声音轮流靠近同一个决定，句子因此保留了彼此的棱角。"
      : "叙事贴着沈砚的观察推进，所有线索都先落在可验证的细节上。";
    const content = [
      `${previousLine}${interventionLine}`,
      `沈砚把那张没有日期的记录摊在灯下。纸面没有署名，笔迹却和他自己的手一样熟悉。${guidance}`,
      `门外传来三下短促的敲击。林照没有进门，只把一枚被潮气浸透的铜片推过门缝，提醒他：真相不是答案，而是需要付出的代价。${modeLine}`,
      `沈砚没有立刻回答。他把铜片翻到背面，看见一行刚刚显出的字：下一次潮线退去以前，别相信任何没有日期的记忆。目标字数：${targetWordCount}。`,
    ].join("\n\n");
    return {
      title,
      content,
      guidance,
      worldIntervention,
      writerType,
      targetWordCount,
      summary: `第${number}章已生成，采用${writerType === "ensemble" ? "写手群" : "单写手"}模式。`,
    };
  }

  polish(content) {
    const paragraphs = String(content)
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .trim()
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => /[。！？.!?]$/.test(paragraph) ? paragraph : `${paragraph}。`);
    return paragraphs.join("\n\n");
  }

  postHoc(chapter, context = {}) {
    const sentenceCount = chapter.content.split(/[。！？!?]/).filter(Boolean).length;
    const nextHook = sentenceCount > 0
      ? "下一章从没有日期的记忆继续，先验证铜片上的字迹。"
      : "下一章需要补充可验证的行动线索。";
    return {
      status: "completed",
      chapterNumber: chapter.number,
      createdAt: new Date().toISOString(),
      observations: [
        `正文包含约 ${sentenceCount} 个句子，已检查章节行动和线索落点。`,
        context.previous ? `已对照上一章「${context.previous.title}」的连续性。` : "这是当前书稿的第一章。",
      ],
      continuity: {
        nextChapterHook: nextHook,
        unresolved: ["铜片上的字迹来源", "没有日期的记忆是否可靠"],
      },
      summary: "后验检查完成，章节可以进入下一章。",
    };
  }
}

async function generationContext(storage, slug, number) {
  const chapters = await listChapters(storage, slug);
  return { previous: previousChapterSummary(number, chapters), chapters };
}

async function generateChapter(storage, slug, chapterNumber, input, source, engine) {
  const book = await assertPreparationReady(storage, slug);
  const number = normalizeChapterNumber(chapterNumber);
  const current = await loadChapter(storage, slug, number);
  if (current) await createVersion(storage, slug, current, `${source}-before`);
  const result = engine.generate(book, number, input, await generationContext(storage, slug, number));
  const now = new Date().toISOString();
  const chapter = {
    number,
    title: result.title,
    status: "draft",
    contentPath: `story/${number}/chapter.md`,
    wordCount: wordCount(result.content),
    createdAt: current?.createdAt || now,
    updatedAt: now,
    generatedAt: now,
    guidance: result.guidance,
    worldIntervention: result.worldIntervention,
    writerType: result.writerType,
    targetWordCount: result.targetWordCount,
    content: result.content,
  };
  await clearPostHoc(storage, slug, number);
  await writeCurrentChapter(storage, slug, chapter);
  return {
    run: {
      id: `mock-${randomUUID()}`,
      mode: engine.mode,
      workflowId: "bishu-novel-mvp",
      chapterNumber: number,
      operation: source,
      status: "completed",
      startedAt: now,
      completedAt: new Date().toISOString(),
    },
    chapter: { ...chapter, content: undefined },
    content: result.content,
    summary: result.summary,
  };
}

export async function listChapters(storage, slug) {
  await storage.getBook(slug);
  const root = path.join(storage.bookDir(slug), "story");
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const chapters = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^\d{4,6}$/.test(entry.name)) continue;
      const chapter = await loadChapter(storage, slug, entry.name);
      if (chapter) {
        const { content, ...summary } = chapter;
        chapters.push(summary);
      }
    }
    return chapters.sort((left, right) => Number(left.number) - Number(right.number));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function getChapter(storage, slug, chapterNumber) {
  const chapter = await requireChapter(storage, slug, chapterNumber);
  const versions = await listChapterVersions(storage, slug, chapter.number);
  return { chapter: { ...chapter, content: undefined }, content: chapter.content, versions };
}

export async function runChapterGeneration(storage, slug, chapterNumber, input = {}, engine = new MockChapterGenerationEngine()) {
  return generateChapter(storage, slug, chapterNumber, input, "generate", engine);
}

export async function regenerateChapter(storage, slug, chapterNumber, input = {}, engine = new MockChapterGenerationEngine()) {
  return generateChapter(storage, slug, chapterNumber, input, "regenerate", engine);
}

export async function saveChapter(storage, slug, chapterNumber, input = {}) {
  const current = await requireChapter(storage, slug, chapterNumber);
  const content = requiredText(input.content, "正文");
  const title = input.title === undefined ? current.title : requiredText(input.title, "章节标题", 200);
  const version = await createVersion(storage, slug, current, "edit-before");
  const now = new Date().toISOString();
  const chapter = {
    ...current,
    title,
    status: "draft",
    wordCount: wordCount(content),
    updatedAt: now,
    content,
    finalizedAt: undefined,
    postHocPath: undefined,
  };
  await clearPostHoc(storage, slug, chapter.number);
  await writeCurrentChapter(storage, slug, chapter);
  return { chapter: { ...chapter, content: undefined }, content, versionId: version.id };
}

export async function listChapterVersions(storage, slug, chapterNumber) {
  await storage.getBook(slug);
  const { root, number } = chapterDirectory(storage, slug, chapterNumber);
  const versionsRoot = path.join(root, "versions");
  try {
    const entries = await fs.readdir(versionsRoot, { withFileTypes: true });
    const versions = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const version = await readJson(path.join(versionsRoot, entry.name));
      if (!version || version.chapterNumber !== number) continue;
      const { content, ...summary } = version;
      versions.push({ ...summary, wordCount: wordCount(content || "") });
    }
    return versions.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function restoreChapterVersion(storage, slug, chapterNumber, versionId) {
  const current = await requireChapter(storage, slug, chapterNumber);
  if (typeof versionId !== "string" || !VERSION_ID.test(versionId)) {
    throw new ChapterError("版本标识无效", 400);
  }
  const { root, number } = chapterDirectory(storage, slug, chapterNumber);
  const version = await readJson(path.join(root, "versions", `${versionId}.json`));
  if (!version || version.chapterNumber !== number) throw new ChapterError("版本不存在", 404);
  await createVersion(storage, slug, current, "restore-before");
  const now = new Date().toISOString();
  const chapter = {
    ...current,
    title: version.title,
    status: "draft",
    wordCount: wordCount(version.content),
    updatedAt: now,
    content: requiredText(version.content, "版本正文"),
    finalizedAt: undefined,
    postHocPath: undefined,
  };
  await clearPostHoc(storage, slug, chapter.number);
  await writeCurrentChapter(storage, slug, chapter);
  return { chapter: { ...chapter, content: undefined }, content: chapter.content, restoredFrom: version.id };
}

export async function polishChapter(storage, slug, chapterNumber, engine = new MockChapterGenerationEngine()) {
  const current = await requireChapter(storage, slug, chapterNumber);
  const content = requiredText(engine.polish(current.content), "润色正文");
  const version = await createVersion(storage, slug, current, "polish-before");
  const now = new Date().toISOString();
  const chapter = {
    ...current,
    status: "draft",
    wordCount: wordCount(content),
    updatedAt: now,
    content,
    finalizedAt: undefined,
    postHocPath: undefined,
  };
  await clearPostHoc(storage, slug, chapter.number);
  await writeCurrentChapter(storage, slug, chapter);
  return { chapter: { ...chapter, content: undefined }, content, versionId: version.id, summary: "章节润色完成。" };
}

export async function finalizeChapter(storage, slug, chapterNumber, engine = new MockChapterGenerationEngine()) {
  const current = await requireChapter(storage, slug, chapterNumber);
  const context = await generationContext(storage, slug, current.number);
  const postHoc = engine.postHoc(current, context);
  const { root } = chapterDirectory(storage, slug, current.number);
  await writeJson(path.join(root, "post-hoc.json"), postHoc);
  const now = new Date().toISOString();
  const chapter = {
    ...current,
    status: "finalized",
    updatedAt: now,
    finalizedAt: now,
    postHocPath: `story/${current.number}/post-hoc.json`,
  };
  await writeCurrentChapter(storage, slug, chapter);
  return { chapter: { ...chapter, content: undefined }, content: current.content, postHoc, summary: postHoc.summary };
}

export async function exportChapters(storage, slug, options = {}) {
  const book = await storage.getBook(slug);
  const chapters = await listChapters(storage, slug);
  if (!chapters.length) throw new ChapterError("没有可导出的章节", 404);
  const from = options.from === undefined || options.from === "" ? null : normalizeChapterNumber(options.from);
  const to = options.to === undefined || options.to === "" ? null : normalizeChapterNumber(options.to);
  if (from && to && Number(from) > Number(to)) throw new ChapterError("导出起始章节不能晚于结束章节", 400);
  const selected = chapters.filter((chapter) => (!from || Number(chapter.number) >= Number(from)) && (!to || Number(chapter.number) <= Number(to)));
  if (!selected.length) throw new ChapterError("指定范围内没有章节", 404);
  const format = options.format === "txt" ? "txt" : options.format === "md" || !options.format ? "md" : null;
  if (!format) throw new ChapterError("导出格式必须是 md 或 txt", 400);
  const sections = [];
  for (const chapter of selected) {
    const full = await loadChapter(storage, slug, chapter.number);
    const heading = `第${chapter.number}章 ${chapter.title}`;
    sections.push(format === "md" ? `## ${heading}\n\n${full.content}` : `${heading}\n\n${full.content}`);
  }
  const content = `${format === "md" ? `# ${book.title}` : book.title}\n\n${sections.join("\n\n")}`.trim() + "\n";
  return {
    format,
    filename: `${slug}.${format}`,
    chapters: selected.map((chapter) => chapter.number),
    content,
  };
}
