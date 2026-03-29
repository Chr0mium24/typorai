import type {
  DocumentRecord,
  FolderRecord,
  WorkspaceSession,
  WorkspaceSnapshot,
} from '../../shared/workspace';

export type {
  DocumentRecord,
  FolderRecord,
  WorkspaceSession,
  WorkspaceSnapshot,
} from '../../shared/workspace';
export {
  ROOT_FOLDER_ID,
  defaultWorkspaceSession,
} from '../../shared/workspace';

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

export type PersistenceState = {
  status: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt?: string;
  lastError?: string | null;
};

export type TreeFolder = FolderRecord & {
  childFolders: TreeFolder[];
  documents: DocumentRecord[];
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
