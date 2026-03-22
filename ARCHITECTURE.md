# TyporAI Architecture

## 1. Product Goal

Build a pure frontend static app with:

- Typora-like writing flow based on Milkdown WYSIWYG editing
- multi-window or multi-document editing
- autosave on every edit
- reopen previous workspace on next launch
- user-supplied API configuration to enable AI features
- GitHub Actions to update published static content
- automatic git commit after changes are stabilized

The system must remain deployable as a static site, with no custom backend.

## 2. Hard Constraints

### 2.1 Pure frontend means no secret server-side broker

This has two direct consequences:

- AI API keys must be entered by the user and stored locally in the browser
- GitHub write access must also come from the user, usually via a fine-grained PAT

If the app must auto-commit content changes to GitHub from the browser, there is no safe hidden credential. The browser needs a user-provided token with repo content write access.

### 2.2 "Every change auto-commit" cannot mean every keystroke

GitHub API rate limits, repository noise, and GitHub Actions cost make per-keystroke commits impractical.

Recommended interpretation:

- local autosave: near real time
- remote sync commit: debounce after idle period
- force commit: on blur, manual sync, window close, or explicit publish

## 3. Recommended Stack

### Frontend

- Vite
- React
- TypeScript
- Milkdown
- Zustand for app state
- Dexie over IndexedDB for local persistence
- BroadcastChannel for cross-window state sync

### GitHub integration

- direct REST calls to GitHub Contents API or Git Data API
- optional `@octokit/rest` in browser, but plain `fetch` is enough

### AI integration

- provider abstraction over OpenAI-compatible chat APIs
- streaming responses via `fetch`
- local prompt templates and action registry

### Static publishing

- GitHub Actions
- GitHub Pages deployment

## 4. High-Level Architecture

```text
Browser App
  ├─ Editor Shell
  │   ├─ Milkdown editor instance
  │   ├─ document tabs / windows
  │   └─ AI panel and inline commands
  ├─ Local Persistence Layer
  │   ├─ IndexedDB documents
  │   ├─ editor/session state
  │   └─ API/token settings
  ├─ Sync Engine
  │   ├─ change detection
  │   ├─ autosave scheduler
  │   ├─ GitHub commit queue
  │   └─ conflict handling
  └─ AI Engine
      ├─ provider adapters
      ├─ prompt builders
      ├─ context extraction
      └─ result apply/preview flow

GitHub Repo
  ├─ content/*.md
  ├─ app static assets
  └─ generated manifests / indexes

GitHub Actions
  ├─ content validation
  ├─ static artifact generation
  └─ deploy to Pages
```

## 5. Core Modules

### 5.1 Editor Shell

Responsibilities:

- render Typora-like editing experience
- open multiple documents as tabs
- optionally open document in a new browser window
- restore previous workspace on launch

Implementation notes:

- one document maps to one markdown source
- each window keeps lightweight UI state: cursor, scroll, active panel, draft status
- save editor snapshot after significant changes

### 5.2 Workspace Store

Persistent entities:

- `documents`
- `document_snapshots`
- `workspace_sessions`
- `provider_settings`
- `github_settings`
- `sync_jobs`

Suggested document schema:

```ts
type DocumentRecord = {
  id: string
  slug: string
  title: string
  markdown: string
  updatedAt: string
  remoteSha?: string
  remotePath: string
  dirty: boolean
  lastSyncedAt?: string
}
```

### 5.3 Autosave Engine

Recommended save behavior:

- save to IndexedDB 300ms to 800ms after input settles
- generate snapshot every 20s to 60s or on large change
- mark document `dirty` immediately
- emit sync job after a longer idle debounce

This gives Typora-like "always saved" behavior without tying the user to network success.

### 5.4 Multi-Window Support

There are two reasonable modes:

- multi-document tabs in one SPA window
- multiple browser windows using `window.open`

For actual multi-window behavior, use:

- shared IndexedDB as source of truth
- `BroadcastChannel` to notify other windows about document changes
- a lightweight document lock to prevent silent overwrite

Recommended rule:

- same document opened in multiple windows uses last-write-wins locally
- if concurrent edits are detected, create a recovery copy instead of destructive merge for MVP

CRDT or Yjs can be added later, but is not required for the first single-user release.

## 6. AI-First Design

AI is the differentiator, so it should be a first-class subsystem rather than a helper button.

### 6.1 Provider Config

User-configurable fields:

- provider name
- base URL
- API key
- model
- optional organization or custom headers

Store locally only. Do not sync secrets to GitHub.

### 6.2 AI Action Model

Instead of one generic chat box, provide structured actions:

- rewrite selection
- continue writing
- summarize document
- convert notes to article
- translate
- extract TODOs
- explain current section
- generate outline
- polish style

Each action should define:

- required context
- prompt template
- streaming mode
- output mode: replace selection, append below, side preview, or create new doc

### 6.3 Context Assembly

Context should be layered, not just "whole document":

- current selection
- surrounding blocks
- document title and frontmatter
- recent document summary
- optional linked documents
- user instruction

For large documents, summarize upstream sections before sending to the model.

### 6.4 Safe Apply Flow

AI output should not directly mutate the document by default.

Recommended flow:

- stream result into side panel
- show diff or replacement preview
- user accepts or inserts result
- accepted result becomes normal editor content

This avoids accidental corruption and makes AI usable for serious writing.

### 6.5 Extensibility

Define provider and action interfaces early:

```ts
type AIProvider = {
  id: string
  generate(input: AIRequest): AsyncIterable<AIChunk>
}

type AIAction = {
  id: string
  label: string
  buildRequest(ctx: AIContext): AIRequest
  applyMode: "replace" | "insert" | "preview" | "new-document"
}
```

This lets the app support OpenAI-compatible providers, Anthropic-style adapters, or local gateway endpoints later.

## 7. GitHub Sync and Auto-Commit

### 7.1 Recommended content model

Repository is the source of truth for published content:

- `content/<slug>.md` for documents
- `content/_meta.json` or generated manifest for ordering and metadata

Browser local state is the working cache and offline buffer.

### 7.2 Commit pipeline

1. User edits document
2. app saves locally immediately
3. sync engine schedules remote push after idle
4. app loads latest remote SHA for the target file
5. app creates updated file content through GitHub API
6. GitHub creates a commit
7. push triggers GitHub Actions
8. Actions rebuild generated static assets and redeploy Pages

### 7.3 Debounce strategy

Recommended defaults:

- local autosave: 500ms
- remote sync commit: 10s to 20s idle
- immediate sync on:
  - window close
  - tab blur
  - explicit publish
  - document switch if dirty for a long time

### 7.4 Conflict strategy

Because this is pure frontend and likely single-user:

- compare stored `remoteSha` before write
- if SHA changed, fetch latest remote content
- create a conflict copy locally
- let user choose replace, duplicate, or manual merge

Do not try to silently merge markdown on first release.

## 8. GitHub Actions Role

GitHub Actions should not be the editor backend. Its job is post-commit processing.

Recommended workflow:

- trigger on push to `main`
- validate changed markdown
- generate document manifest, search index, and optional pre-rendered HTML
- build the static frontend
- deploy to GitHub Pages

Example outputs:

- `public/generated/manifest.json`
- `public/generated/search-index.json`
- `public/generated/html/<slug>.html`

## 9. Startup and Restore Flow

On app launch:

1. load workspace state from IndexedDB
2. reopen last active documents and cursor positions
3. restore editor layout and side panels
4. if GitHub is configured, fetch lightweight remote manifest
5. show sync status and recover unsynced local drafts if needed

This matches the "open and continue writing immediately" behavior expected from Typora-like tools.

## 10. Security Reality

Pure frontend has unavoidable limits:

- API keys are exposed to the browser runtime
- GitHub PAT is exposed to the browser runtime
- secrets can only be protected locally, not truly hidden

Mitigations:

- recommend fine-grained PAT with only one repo and content write permission
- keep tokens in IndexedDB, optionally encrypted with WebCrypto and a user passphrase
- never commit secret-bearing settings files
- provide a "local-only mode" when GitHub sync is not configured

## 11. Recommended MVP Scope

### Phase 1

- React + Vite + TypeScript skeleton
- Milkdown editor
- IndexedDB autosave
- reopen last workspace
- single-window multi-tab documents

### Phase 2

- GitHub PAT settings
- markdown file sync to repo
- auto-commit debounce queue
- GitHub Actions build and Pages deploy

### Phase 3

- AI provider settings
- AI side panel
- rewrite, continue, summarize, translate
- diff preview before apply

### Phase 4

- true multi-window support
- conflict copies and restore center
- generated search index and document graph

## 12. Key Recommendation

The cleanest architecture is:

- offline-first browser editor
- IndexedDB as immediate persistence
- GitHub repo as published content source of truth
- GitHub Actions as post-commit static rebuild pipeline
- AI as a provider-driven subsystem with structured writing actions

If implementation starts now, the first slice should be:

1. scaffold the static React app
2. integrate Milkdown
3. implement IndexedDB autosave and session restore
4. add a sync abstraction that can later target GitHub

This minimizes rework and keeps the AI layer from being bolted on later.
