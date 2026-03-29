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
  dirty: boolean;
  lastSavedAt?: string;
  saveError?: string | null;
};

export type WorkspaceSession = {
  openDocumentIds: string[];
  activeDocumentId: string | null;
  selectedFolderId: string | null;
  sidebarCollapsed: boolean;
  editorMode: 'wysiwyg' | 'source';
};

export type WorkspaceSnapshot = {
  documents: DocumentRecord[];
  folders: FolderRecord[];
  session: WorkspaceSession;
};

export const ROOT_FOLDER_ID = '__workspace_root__';

export const defaultWorkspaceSession: WorkspaceSession = {
  openDocumentIds: [],
  activeDocumentId: null,
  selectedFolderId: null,
  sidebarCollapsed: false,
  editorMode: 'wysiwyg',
};

const now = () => new Date().toISOString();

const createId = () => crypto.randomUUID();

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';

export const createFolderRecord = (
  name: string,
  parentId: string | null,
): FolderRecord => {
  const timestamp = now();
  return {
    id: createId(),
    name,
    parentId,
    expanded: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const createDocumentRecord = (
  title: string,
  parentFolderId: string | null,
): DocumentRecord => {
  const timestamp = now();
  return {
    id: createId(),
    title,
    slug: `${slugify(title)}-${Math.random().toString(36).slice(2, 8)}`,
    parentFolderId,
    markdown: `# ${title}\n\n开始写吧。\n`,
    createdAt: timestamp,
    updatedAt: timestamp,
    dirty: true,
    saveError: null,
  };
};

export const createDocumentRecordFromMarkdown = (
  title: string,
  markdown: string,
  parentFolderId: string | null,
): DocumentRecord => {
  const document = createDocumentRecord(title, parentFolderId);
  return {
    ...document,
    markdown,
  };
};

export const buildDefaultWorkspace = (): WorkspaceSnapshot => {
  const timestamp = now();
  const inbox = createFolderRecord('Inbox', null);
  const research = createFolderRecord('Research', null);

  const welcome = createDocumentRecord('Welcome to TyporAI', inbox.id);
  welcome.markdown = [
    '# Welcome to TyporAI',
    '',
    '这是一个为单人写作者准备的前后端一体工作台。',
    '',
    '- 左侧是文件树和文件夹',
    '- 顶部是当前打开文档的 tabs',
    '- 内容会自动保存到 TS 后端',
    '- 你也可以手动立即保存',
    '',
    '现在可以直接开始写。',
  ].join('\n');

  const brief = createDocumentRecord('Product Notes', research.id);
  brief.markdown = [
    '# Product Notes',
    '',
    '## This MVP includes',
    '',
    '- Milkdown editor',
    '- file tree',
    '- tabs',
    '- backend autosave',
    '- responsive layout',
  ].join('\n');

  const cleanDocuments = [welcome, brief].map((document) => ({
    ...document,
    dirty: false,
    lastSavedAt: timestamp,
    saveError: null,
  }));

  const session: WorkspaceSession = {
    ...defaultWorkspaceSession,
    openDocumentIds: cleanDocuments.map((document) => document.id),
    activeDocumentId: cleanDocuments[0]?.id ?? null,
    selectedFolderId: null,
  };

  return {
    documents: cleanDocuments,
    folders: [inbox, research],
    session,
  };
};
