import fs from "node:fs/promises";
import path from "node:path";

const BOOK_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const BOOK_FIELDS = [
  "title",
  "premise",
  "genre",
  "style",
  "length",
  "chapterWords",
  "mode",
];

export class StorageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "StorageError";
    this.status = status;
  }
}

export function assertBookSlug(slug) {
  if (typeof slug !== "string" || !BOOK_SLUG.test(slug)) {
    throw new StorageError("书籍标识必须是小写字母、数字和连字符", 400);
  }
  return slug;
}

export function slugifyTitle(title) {
  const ascii = String(title ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return ascii || `book-${Date.now().toString(36)}`;
}

function requireText(value, field, maxLength) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new StorageError(`${field}不能为空`);
  }
  if (value.length > maxLength) {
    throw new StorageError(`${field}过长`);
  }
  return value.trim();
}

function normalizeCreateInput(input) {
  const data = input && typeof input === "object" ? input : {};
  const title = requireText(data.title, "书名", 120);
  const premise = requireText(data.premise, "立意", 50000);
  const genre = requireText(data.genre, "题材", 80);
  const style = requireText(data.style, "风格", 120);
  const length = requireText(data.length, "篇幅", 40);
  const chapterWords = requireText(String(data.chapterWords ?? ""), "每章字数", 40);
  const mode = data.mode === "auto" ? "auto" : "review";
  return { title, premise, genre, style, length, chapterWords, mode };
}

function normalizePatch(input) {
  const data = input && typeof input === "object" ? input : {};
  const patch = {};
  for (const field of BOOK_FIELDS) {
    if (data[field] === undefined) continue;
    if (field === "mode") {
      if (data[field] !== "review" && data[field] !== "auto") {
        throw new StorageError("推进模式无效");
      }
      patch[field] = data[field];
      continue;
    }
    patch[field] = requireText(String(data[field]), field, field === "premise" ? 50000 : 240);
  }
  return patch;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class BookStorage {
  constructor(dataRoot = path.join(process.cwd(), "data")) {
    this.dataRoot = path.resolve(dataRoot);
    this.booksRoot = path.join(this.dataRoot, "books");
  }

  async init() {
    await fs.mkdir(this.booksRoot, { recursive: true });
  }

  bookDir(slug) {
    assertBookSlug(slug);
    const target = path.resolve(this.booksRoot, slug);
    if (!target.startsWith(`${this.booksRoot}${path.sep}`)) {
      throw new StorageError("非法书籍路径", 400);
    }
    return target;
  }

  async createBook(input) {
    await this.init();
    const data = normalizeCreateInput(input);
    let requestedSlug = input?.slug ? String(input.slug).trim().toLowerCase() : slugifyTitle(data.title);
    assertBookSlug(requestedSlug);
    let slug = requestedSlug;
    let suffix = 2;
    while (await exists(this.bookDir(slug))) {
      if (input?.slug) throw new StorageError("书籍标识已存在", 409);
      slug = `${requestedSlug}-${suffix++}`;
    }
    const now = new Date().toISOString();
    const book = {
      slug,
      ...data,
      stage: "premise",
      completedStages: [],
      createdAt: now,
      updatedAt: now,
    };
    const dir = this.bookDir(slug);
    await fs.mkdir(dir, { recursive: true });
    for (const child of ["meta", "world", "outline", "story", "archive", "cache"]) {
      await fs.mkdir(path.join(dir, child), { recursive: true });
    }
    await this.writeJson(path.join(dir, "book.json"), book);
    return book;
  }

  async listBooks() {
    await this.init();
    const entries = await fs.readdir(this.booksRoot, { withFileTypes: true });
    const books = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !BOOK_SLUG.test(entry.name)) continue;
      try {
        books.push(await this.getBook(entry.name));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    return books.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getBook(slug) {
    const filePath = path.join(this.bookDir(slug), "book.json");
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") throw new StorageError("作品不存在", 404);
      throw error;
    }
  }

  async updateBook(slug, input) {
    const current = await this.getBook(slug);
    const patch = normalizePatch(input);
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await this.writeJson(path.join(this.bookDir(slug), "book.json"), updated);
    return updated;
  }

  async setBookProgress(slug, stage, completedStages) {
    const current = await this.getBook(slug);
    const updated = { ...current, stage, completedStages, updatedAt: new Date().toISOString() };
    await this.writeJson(path.join(this.bookDir(slug), "book.json"), updated);
    return updated;
  }

  async deleteBook(slug) {
    await this.getBook(slug);
    await fs.rm(this.bookDir(slug), { recursive: true, force: true });
    return { slug, deleted: true };
  }

  bookFile(slug, relativePath) {
    const bookRoot = this.bookDir(slug);
    if (typeof relativePath !== "string" || relativePath.trim() === "") {
      throw new StorageError("文件路径不能为空", 400);
    }
    const normalized = relativePath.replaceAll("\\", "/");
    if (normalized.startsWith("/") || normalized.split("/").some((part) => part === ".." || part === "")) {
      throw new StorageError("非法文件路径", 400);
    }
    const target = path.resolve(bookRoot, normalized);
    if (!target.startsWith(`${bookRoot}${path.sep}`)) {
      throw new StorageError("非法文件路径", 400);
    }
    return { target, relativePath: normalized };
  }

  async writeBookText(slug, relativePath, value) {
    const { target } = this.bookFile(slug, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, String(value), "utf8");
    return relativePath.replaceAll("\\", "/");
  }

  async readBookText(slug, relativePath) {
    const { target } = this.bookFile(slug, relativePath);
    try {
      return await fs.readFile(target, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") throw new StorageError("文件不存在", 404);
      throw error;
    }
  }

  async listBookFiles(slug) {
    const root = this.bookDir(slug);
    await this.getBook(slug);
    const files = [];
    async function visit(current, prefix = "") {
      for (const entry of await fs.readdir(current, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await visit(path.join(current, entry.name), relative);
        else files.push(relative);
      }
    }
    await visit(root);
    return files.sort();
  }

  async writeJson(filePath, value) {
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
}
