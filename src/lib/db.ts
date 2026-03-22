import Dexie, { type Table } from 'dexie';
import type {
  AppSettingRecord,
  DocumentRecord,
  FolderRecord,
  GithubSettings,
  WorkspaceSession,
} from '../types/workspace';
import {
  defaultGithubSettings,
  defaultWorkspaceSession,
} from '../types/workspace';
import { buildDefaultWorkspace } from './default-workspace';

class WorkspaceDB extends Dexie {
  documents!: Table<DocumentRecord, string>;
  folders!: Table<FolderRecord, string>;
  settings!: Table<AppSettingRecord, string>;

  constructor() {
    super('typorai-workspace');
    this.version(1).stores({
      documents: 'id,parentFolderId,updatedAt,remoteDirty',
      folders: 'id,parentId,updatedAt',
      settings: 'id',
    });
  }
}

export const workspaceDB = new WorkspaceDB();

export type WorkspaceSnapshot = {
  documents: DocumentRecord[];
  folders: FolderRecord[];
  session: WorkspaceSession;
  githubSettings: GithubSettings;
};

export const loadWorkspaceSnapshot = async (): Promise<WorkspaceSnapshot> => {
  const [documents, folders, sessionSetting, githubSetting] = await Promise.all([
    workspaceDB.documents.toArray(),
    workspaceDB.folders.toArray(),
    workspaceDB.settings.get('session'),
    workspaceDB.settings.get('github'),
  ]);

  if (documents.length === 0 && folders.length === 0) {
    const defaults = buildDefaultWorkspace();
    await Promise.all([
      workspaceDB.documents.bulkPut(defaults.documents),
      workspaceDB.folders.bulkPut(defaults.folders),
      workspaceDB.settings.put({ id: 'session', value: defaults.session }),
      workspaceDB.settings.put({
        id: 'github',
        value: defaultGithubSettings,
      }),
    ]);

    return {
      documents: defaults.documents,
      folders: defaults.folders,
      session: defaults.session,
      githubSettings: defaultGithubSettings,
    };
  }

  return {
    documents,
    folders,
    session:
      sessionSetting?.id === 'session'
        ? sessionSetting.value
        : defaultWorkspaceSession,
    githubSettings:
      githubSetting?.id === 'github'
        ? githubSetting.value
        : defaultGithubSettings,
  };
};

export const persistDocument = async (document: DocumentRecord) => {
  await workspaceDB.documents.put(document);
};

export const persistFolders = async (folders: FolderRecord[]) => {
  if (folders.length === 0) return;
  await workspaceDB.folders.bulkPut(folders);
};

export const persistSession = async (session: WorkspaceSession) => {
  await workspaceDB.settings.put({ id: 'session', value: session });
};

export const persistGithubSettings = async (settings: GithubSettings) => {
  await workspaceDB.settings.put({ id: 'github', value: settings });
};

