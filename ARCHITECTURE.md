# TyporAI Architecture

## Overview

TyporAI 现在是一个前后端一体的 TypeScript 应用：

- 前端：React + Vite + Zustand + Milkdown
- 后端：Node HTTP server（TypeScript）
- 存储：后端将工作区 JSON 落到本地 `data/workspace.json`
- AI 设置：仍只保存在浏览器本地

## Runtime Layout

```text
Browser
  ├─ React UI
  ├─ Zustand workspace store
  └─ calls /api/workspace

TS Backend
  ├─ GET /api/health
  ├─ GET /api/workspace
  ├─ PUT /api/workspace
  └─ persists data/workspace.json
```

## Persistence Model

后端保存的是整个工作区快照：

```ts
type WorkspaceSnapshot = {
  documents: DocumentRecord[];
  folders: FolderRecord[];
  session: WorkspaceSession;
};
```

其中：

- `documents` 保存文章内容与元信息
- `folders` 保存目录树
- `session` 保存当前打开标签、激活文档和编辑模式

文档记录包含：

- `dirty`: 当前文档是否还有未落盘修改
- `lastSavedAt`: 最近一次后端保存时间
- `saveError`: 最近一次保存错误

## Save Flow

1. 用户在编辑器中修改标题、正文、文件夹或工作区状态
2. Zustand store 标记工作区版本已变更
3. 前端用 500ms debounce 调用 `PUT /api/workspace`
4. 后端原子写入 `data/workspace.json`
5. 前端把已成功写入的文档标记为已保存

用户也可以手动触发“立即保存”。

## Dev Workflow

`bash scripts/start.sh` 会同时启动：

- Vite 前端开发服务，默认 `127.0.0.1:5173`
- TypeScript 后端服务，默认 `127.0.0.1:3001`
- server TypeScript watch 编译

Vite 会把 `/api/*` 代理到后端。

## Build And Serve

`pnpm build` 会：

1. 检查前端 TypeScript
2. 编译后端到 `.server-dist/`
3. 打包前端到 `dist/`

`pnpm serve` 会启动编译后的后端，并由后端托管 `dist/` 静态文件。

## Notes

- GitHub Actions / GitHub Pages / GitHub Contents API 已经不再参与文章存储
- 文章内容的唯一持久化入口是 TS 后端
- AI API Key 仍然只在浏览器本地保存，不写入后端数据文件
