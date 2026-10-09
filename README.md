# myflow

本项目是一个面向个人作者的本地笔枢风格写作台。书籍、设定和章节保存在本机 `data/books/`，右上角模型配置可以保存并测试 OpenAI 兼容接口。当前创作流程仍使用确定性模拟生成器，真实模型和 DeterminFlow 生成适配尚未接入。

## 开发状态

书架、建书四阶段、章节生产与编辑、历史版本、后验定稿、Markdown/TXT 导出和模型接入配置已可用。详细操作见 [`docs/LOCAL-USAGE.md`](docs/LOCAL-USAGE.md)，实施计划见 [`docs/LOCAL-BISHU-PLAN.md`](docs/LOCAL-BISHU-PLAN.md)。

## 运行要求

- Node.js 20 或更高版本
- Windows、macOS 或 Linux

## 开发命令

```bash
npm test
npm start
```

启动后访问 `http://localhost:4317`。
