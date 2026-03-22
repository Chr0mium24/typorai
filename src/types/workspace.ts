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

export type AppSettingRecord =
  | { id: 'session'; value: WorkspaceSession }
  | { id: 'github'; value: GithubSettings };

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

export const defaultGithubSettings: GithubSettings = {
  owner: '',
  repo: '',
  branch: 'main',
  contentRoot: 'content',
  token: '',
  authorName: '',
  authorEmail: '',
};

export const defaultWorkspaceSession: WorkspaceSession = {
  openDocumentIds: [],
  activeDocumentId: null,
  selectedFolderId: null,
  sidebarCollapsed: false,
  editorMode: 'wysiwyg',
};
