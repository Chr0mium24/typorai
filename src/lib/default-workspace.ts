import {
  type DocumentRecord,
  type FolderRecord,
  type WorkspaceSession,
  defaultWorkspaceSession,
} from '../types/workspace';

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
    remoteDirty: true,
    pendingSyncSince: timestamp,
    syncError: null,
  };
};

export const buildDefaultWorkspace = (): {
  documents: DocumentRecord[];
  folders: FolderRecord[];
  session: WorkspaceSession;
} => {
  const inbox = createFolderRecord('Inbox', null);
  const research = createFolderRecord('Research', null);

  const welcome = createDocumentRecord('Welcome to TyporAI', inbox.id);
  welcome.markdown = [
    '# Welcome to TyporAI',
    '',
    '这是一个为单人写作者准备的静态前端工作台。',
    '',
    '- 左侧是文件树和文件夹',
    '- 顶部是当前打开文档的 tabs',
    '- 内容会自动保存在浏览器里',
    '- GitHub 同步会在空闲时自动触发',
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
    '- local autosave',
    '- responsive layout',
  ].join('\n');

  const session: WorkspaceSession = {
    ...defaultWorkspaceSession,
    openDocumentIds: [welcome.id, brief.id],
    activeDocumentId: welcome.id,
    selectedFolderId: inbox.id,
  };

  return {
    documents: [welcome, brief],
    folders: [inbox, research],
    session,
  };
};

