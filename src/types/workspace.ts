export type FolderRecord = {
  id: string;
  name: string;
  parentId: string | null;
  expanded: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DocumentRecord = {
  id: string;
  title: string;
  slug: string;
  parentFolderId: string | null;
  markdown: string;
  createdAt: string;
  updatedAt: string;
  lastLocalSaveAt?: string;
  lastRemoteSyncAt?: string;
  remoteSha?: string;
  remoteDirty: boolean;
  pendingSyncSince?: string;
  syncError?: string | null;
};

export type WorkspaceSession = {
  openDocumentIds: string[];
  activeDocumentId: string | null;
  selectedFolderId: string | null;
  sidebarCollapsed: boolean;
  editorMode: 'wysiwyg' | 'source';
};

export type GithubSettings = {
  owner: string;
  repo: string;
  branch: string;
  contentRoot: string;
  token: string;
  authorName: string;
  authorEmail: string;
};

export type AIProviderKind = 'openai-compatible' | 'gemini';

export type OpenAICompatibleSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type GeminiSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type AISettings = {
  provider: AIProviderKind;
  temperature: number;
  systemPrompt: string;
  openAICompatible: OpenAICompatibleSettings;
  gemini: GeminiSettings;
};

export type AppSettingRecord =
  | { id: 'session'; value: WorkspaceSession }
  | { id: 'github'; value: GithubSettings }
  | { id: 'ai'; value: AISettings };

export type SyncState = {
  status: 'idle' | 'queued' | 'syncing' | 'error' | 'setup-required';
  nextSyncAt?: string;
  lastSyncAt?: string;
  lastError?: string | null;
};

export type TreeFolder = FolderRecord & {
  childFolders: TreeFolder[];
  documents: DocumentRecord[];
};

export const ROOT_FOLDER_ID = '__workspace_root__';

export const defaultGithubSettings: GithubSettings = {
  owner: '',
  repo: '',
  branch: 'main',
  contentRoot: 'content',
  token: '',
  authorName: '',
  authorEmail: '',
};

export const defaultAISettings: AISettings = {
  provider: 'openai-compatible',
  temperature: 0.8,
  systemPrompt:
    '你是一个协作写作者。你只基于当前文档上下文继续创作，不解释你的过程，不输出额外前言。',
  openAICompatible: {
    baseUrl: 'https://api.openai.com',
    apiKey: '',
    model: '',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKey: '',
    model: 'gemini-2.5-flash',
  },
};

export const defaultWorkspaceSession: WorkspaceSession = {
  openDocumentIds: [],
  activeDocumentId: null,
  selectedFolderId: null,
  sidebarCollapsed: false,
  editorMode: 'wysiwyg',
};
