import { create } from 'zustand';
import {
  loadWorkspaceSnapshot,
  persistAISettings,
  persistWorkspaceSnapshot,
} from '../lib/db';
import {
  createDocumentRecord,
  createDocumentRecordFromMarkdown,
  createFolderRecord,
} from '../lib/default-workspace';
import type {
  AISettings,
  DocumentRecord,
  FolderRecord,
  PersistenceState,
  WorkspaceSession,
} from '../types/workspace';
import {
  defaultAISettings,
  defaultWorkspaceSession,
  ROOT_FOLDER_ID,
} from '../types/workspace';

const SAVE_DELAY_MS = 500;

let workspaceSaveTimer: number | undefined;
let saveInFlight = false;
let versionCounter = 0;

const nowIso = () => new Date().toISOString();

const allocateVersion = () => {
  versionCounter += 1;
  return versionCounter;
};

const clearWorkspaceSaveTimer = () => {
  if (!workspaceSaveTimer) return;
  window.clearTimeout(workspaceSaveTimer);
  workspaceSaveTimer = undefined;
};

const saveWorkspaceSoon = (
  get: () => WorkspaceStore,
  set: (
    partial:
      | Partial<WorkspaceStore>
      | ((state: WorkspaceStore) => Partial<WorkspaceStore>),
  ) => void,
) => {
  clearWorkspaceSaveTimer();

  const state = get();
  if (state.workspaceVersion <= state.lastSavedWorkspaceVersion) {
    return;
  }

  set((current) => ({
    browserSaveState: 'saving',
    persistenceState: {
      ...current.persistenceState,
      status: 'saving',
      lastError: null,
    },
  }));

  workspaceSaveTimer = window.setTimeout(() => {
    void get().saveNow();
  }, SAVE_DELAY_MS);
};

const resolveParentFolderId = (
  explicitFolderId: string | null | undefined,
  session: WorkspaceSession,
  documents: DocumentRecord[],
) => {
  if (explicitFolderId !== undefined) return explicitFolderId;
  if (session.selectedFolderId === ROOT_FOLDER_ID) return null;
  if (session.selectedFolderId) return session.selectedFolderId;

  const activeDocument = documents.find(
    (document) => document.id === session.activeDocumentId,
  );
  return activeDocument?.parentFolderId ?? null;
};

const collectFolderIds = (folderId: string, folders: FolderRecord[]) => {
  const ids = new Set<string>();
  const walk = (currentId: string) => {
    ids.add(currentId);
    folders
      .filter((folder) => folder.parentId === currentId)
      .forEach((folder) => walk(folder.id));
  };
  walk(folderId);
  return ids;
};

type BrowserSaveState = 'idle' | 'saving' | 'saved';

export type WorkspaceStore = {
  hydrated: boolean;
  documents: DocumentRecord[];
  folders: FolderRecord[];
  session: WorkspaceSession;
  aiSettings: AISettings;
  persistenceState: PersistenceState;
  browserSaveState: BrowserSaveState;
  lastBrowserSaveAt?: string;
  workspaceVersion: number;
  lastSavedWorkspaceVersion: number;
  initialize: () => Promise<void>;
  createDocument: (title?: string, parentFolderId?: string | null) => string;
  createFolder: (name: string, parentFolderId?: string | null) => string;
  deleteDocument: (documentId: string) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  importMarkdownFiles: (
    files: Array<{ name: string; markdown: string }>,
    parentFolderId?: string | null,
  ) => Promise<void>;
  openDocument: (documentId: string) => void;
  closeDocument: (documentId: string) => void;
  setActiveDocument: (documentId: string) => void;
  setSelectedFolder: (folderId: string | null) => void;
  setEditorMode: (mode: WorkspaceSession['editorMode']) => void;
  updateDocumentTitle: (documentId: string, title: string) => void;
  updateDocumentMarkdown: (documentId: string, markdown: string) => void;
  toggleFolderExpanded: (folderId: string) => void;
  toggleSidebar: () => void;
  updateAISettings: (settings: AISettings) => Promise<void>;
  saveNow: () => Promise<void>;
};

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  hydrated: false,
  documents: [],
  folders: [],
  session: defaultWorkspaceSession,
  aiSettings: defaultAISettings,
  persistenceState: { status: 'idle', lastError: null },
  browserSaveState: 'idle',
  lastBrowserSaveAt: undefined,
  workspaceVersion: 0,
  lastSavedWorkspaceVersion: 0,

  initialize: async () => {
    if (get().hydrated) return;

    const snapshot = await loadWorkspaceSnapshot();
    const nextSession =
      snapshot.session.activeDocumentId &&
      snapshot.session.selectedFolderId !== ROOT_FOLDER_ID
        ? {
            ...snapshot.session,
            selectedFolderId: null,
          }
        : snapshot.session;

    const hasLoadError = Boolean(snapshot.workspaceError);

    set({
      hydrated: true,
      documents: snapshot.documents,
      folders: snapshot.folders,
      session: nextSession,
      aiSettings: snapshot.aiSettings,
      persistenceState: hasLoadError
        ? {
            status: 'error',
            lastError: snapshot.workspaceError,
          }
        : {
            status: 'saved',
            lastSavedAt: snapshot.documents.reduce<string | undefined>(
              (latest, document) => {
                if (!document.lastSavedAt) return latest;
                if (!latest || document.lastSavedAt > latest) return document.lastSavedAt;
                return latest;
              },
              undefined,
            ),
            lastError: null,
          },
      browserSaveState: hasLoadError ? 'idle' : 'saved',
      workspaceVersion: 0,
      lastSavedWorkspaceVersion: hasLoadError ? -1 : 0,
    });

    if (nextSession !== snapshot.session) {
      const version = allocateVersion();
      set({ session: nextSession, workspaceVersion: version });
      saveWorkspaceSoon(get, set);
    }
  },

  createDocument: (title = 'Untitled note', parentFolderId) => {
    const state = get();
    const resolvedParent = resolveParentFolderId(
      parentFolderId,
      state.session,
      state.documents,
    );
    const document = createDocumentRecord(title, resolvedParent);
    const version = allocateVersion();

    set((current) => ({
      documents: [...current.documents, document],
      session: {
        ...current.session,
        selectedFolderId: null,
        activeDocumentId: document.id,
        openDocumentIds: Array.from(
          new Set([...current.session.openDocumentIds, document.id]),
        ),
      },
      workspaceVersion: version,
    }));

    saveWorkspaceSoon(get, set);
    return document.id;
  },

  createFolder: (name, parentFolderId) => {
    const state = get();
    const resolvedParent = resolveParentFolderId(
      parentFolderId,
      state.session,
      state.documents,
    );
    const folder = createFolderRecord(name, resolvedParent);
    const version = allocateVersion();

    set((current) => ({
      folders: [...current.folders, folder],
      session: {
        ...current.session,
        selectedFolderId: folder.id,
      },
      workspaceVersion: version,
    }));

    saveWorkspaceSoon(get, set);
    return folder.id;
  },

  deleteDocument: async (documentId) => {
    const state = get();
    const nextDocuments = state.documents.filter((document) => document.id !== documentId);
    const nextOpenDocumentIds = state.session.openDocumentIds.filter(
      (id) => id !== documentId,
    );
    const fallbackActiveDocumentId =
      nextOpenDocumentIds[nextOpenDocumentIds.length - 1] ??
      nextDocuments[nextDocuments.length - 1]?.id ??
      null;
    const version = allocateVersion();

    set({
      documents: nextDocuments,
      session: {
        ...state.session,
        openDocumentIds: nextOpenDocumentIds,
        activeDocumentId:
          state.session.activeDocumentId === documentId
            ? fallbackActiveDocumentId
            : state.session.activeDocumentId,
      },
      workspaceVersion: version,
    });

    saveWorkspaceSoon(get, set);
  },

  deleteFolder: async (folderId) => {
    const state = get();
    const targetFolder = state.folders.find((folder) => folder.id === folderId);
    if (!targetFolder) return;

    const folderIds = collectFolderIds(folderId, state.folders);
    const documentIds = state.documents
      .filter((document) => document.parentFolderId && folderIds.has(document.parentFolderId))
      .map((document) => document.id);

    const nextFolders = state.folders.filter((folder) => !folderIds.has(folder.id));
    const nextDocuments = state.documents.filter(
      (document) => !documentIds.includes(document.id),
    );
    const nextOpenDocumentIds = state.session.openDocumentIds.filter(
      (id) => !documentIds.includes(id),
    );
    const fallbackActiveDocumentId =
      nextOpenDocumentIds[nextOpenDocumentIds.length - 1] ??
      nextDocuments[nextDocuments.length - 1]?.id ??
      null;
    const version = allocateVersion();

    set({
      folders: nextFolders,
      documents: nextDocuments,
      session: {
        ...state.session,
        openDocumentIds: nextOpenDocumentIds,
        activeDocumentId: documentIds.includes(state.session.activeDocumentId ?? '')
          ? fallbackActiveDocumentId
          : state.session.activeDocumentId,
        selectedFolderId: folderIds.has(state.session.selectedFolderId ?? '')
          ? targetFolder.parentId
          : state.session.selectedFolderId,
      },
      workspaceVersion: version,
    });

    saveWorkspaceSoon(get, set);
  },

  importMarkdownFiles: async (files, parentFolderId) => {
    const imports = files
      .map(({ name, markdown }) => {
        const trimmedName = name.trim();
        return {
          title: trimmedName.replace(/\.md$/i, '').trim() || 'Untitled note',
          markdown,
          sourceName: trimmedName,
        };
      })
      .filter(({ sourceName }) => sourceName.toLowerCase().endsWith('.md'));

    if (imports.length === 0) return;

    const state = get();
    const resolvedParent = resolveParentFolderId(
      parentFolderId,
      state.session,
      state.documents,
    );
    const createdDocuments = imports.map(({ title, markdown }) =>
      createDocumentRecordFromMarkdown(title, markdown, resolvedParent),
    );
    const firstDocumentId = createdDocuments[0]?.id ?? null;
    const version = allocateVersion();

    set((current) => ({
      documents: [...current.documents, ...createdDocuments],
      session: {
        ...current.session,
        selectedFolderId: null,
        activeDocumentId: firstDocumentId,
        openDocumentIds: Array.from(
          new Set([
            ...current.session.openDocumentIds,
            ...createdDocuments.map((document) => document.id),
          ]),
        ),
      },
      workspaceVersion: version,
    }));

    saveWorkspaceSoon(get, set);
  },

  openDocument: (documentId) => {
    const state = get();
    const exists = state.documents.some((document) => document.id === documentId);
    if (!exists) return;

    const version = allocateVersion();

    set((current) => ({
      session: {
        ...current.session,
        selectedFolderId: null,
        activeDocumentId: documentId,
        openDocumentIds: Array.from(
          new Set([...current.session.openDocumentIds, documentId]),
        ),
      },
      workspaceVersion: version,
    }));

    saveWorkspaceSoon(get, set);
  },

  closeDocument: (documentId) => {
    const state = get();
    const openDocumentIds = state.session.openDocumentIds.filter(
      (id) => id !== documentId,
    );
    const nextActiveDocumentId =
      state.session.activeDocumentId === documentId
        ? openDocumentIds[openDocumentIds.length - 1] ?? null
        : state.session.activeDocumentId;
    const version = allocateVersion();

    set((current) => ({
      session: {
        ...current.session,
        openDocumentIds,
        activeDocumentId: nextActiveDocumentId,
      },
      workspaceVersion: version,
    }));

    saveWorkspaceSoon(get, set);
  },

  setActiveDocument: (documentId) => {
    const documentExists = get().documents.some((item) => item.id === documentId);
    if (!documentExists) return;

    const version = allocateVersion();

    set((current) => ({
      session: {
        ...current.session,
        selectedFolderId: null,
        activeDocumentId: documentId,
      },
      workspaceVersion: version,
    }));

    saveWorkspaceSoon(get, set);
  },

  setSelectedFolder: (folderId) => {
    const version = allocateVersion();

    set((current) => ({
      session: {
        ...current.session,
        selectedFolderId: folderId ?? ROOT_FOLDER_ID,
      },
      workspaceVersion: version,
    }));

    saveWorkspaceSoon(get, set);
  },

  setEditorMode: (mode) => {
    const version = allocateVersion();

    set((current) => ({
      session: {
        ...current.session,
        editorMode: mode,
      },
      workspaceVersion: version,
    }));

    saveWorkspaceSoon(get, set);
  },

  updateDocumentTitle: (documentId, title) => {
    const trimmedTitle = title.trim() || 'Untitled note';
    const timestamp = nowIso();
    const version = allocateVersion();

    set((state) => ({
      documents: state.documents.map((document) =>
        document.id === documentId
          ? {
              ...document,
              title: trimmedTitle,
              updatedAt: timestamp,
              dirty: true,
              saveError: null,
            }
          : document,
      ),
      workspaceVersion: version,
    }));

    saveWorkspaceSoon(get, set);
  },

  updateDocumentMarkdown: (documentId, markdown) => {
    const timestamp = nowIso();
    const version = allocateVersion();

    set((state) => ({
      documents: state.documents.map((document) =>
        document.id === documentId
          ? {
              ...document,
              markdown,
              updatedAt: timestamp,
              dirty: true,
              saveError: null,
            }
          : document,
      ),
      workspaceVersion: version,
    }));

    saveWorkspaceSoon(get, set);
  },

  toggleFolderExpanded: (folderId) => {
    const timestamp = nowIso();
    const version = allocateVersion();

    set((state) => ({
      folders: state.folders.map((folder) =>
        folder.id === folderId
          ? {
              ...folder,
              expanded: !folder.expanded,
              updatedAt: timestamp,
            }
          : folder,
      ),
      workspaceVersion: version,
    }));

    saveWorkspaceSoon(get, set);
  },

  toggleSidebar: () => {
    const version = allocateVersion();

    set((state) => ({
      session: {
        ...state.session,
        sidebarCollapsed: !state.session.sidebarCollapsed,
      },
      workspaceVersion: version,
    }));

    saveWorkspaceSoon(get, set);
  },

  updateAISettings: async (settings) => {
    set({ aiSettings: settings });
    await persistAISettings(settings);
  },

  saveNow: async () => {
    clearWorkspaceSaveTimer();

    const state = get();
    if (state.workspaceVersion <= state.lastSavedWorkspaceVersion) {
      set((current) => ({
        browserSaveState: 'saved',
        persistenceState: {
          ...current.persistenceState,
          status: current.persistenceState.lastError ? 'error' : 'saved',
        },
      }));
      return;
    }

    if (saveInFlight) return;
    saveInFlight = true;

    const saveStartedAt = nowIso();
    const targetVersion = state.workspaceVersion;

    set((current) => ({
      browserSaveState: 'saving',
      persistenceState: {
        ...current.persistenceState,
        status: 'saving',
        lastError: null,
      },
    }));

    try {
      const result = await persistWorkspaceSnapshot({
        documents: state.documents,
        folders: state.folders,
        session: state.session,
      });

      set((current) => ({
        browserSaveState: 'saved',
        lastBrowserSaveAt: result.savedAt,
        lastSavedWorkspaceVersion: Math.max(
          current.lastSavedWorkspaceVersion,
          targetVersion,
        ),
        documents: current.documents.map((document) =>
          document.updatedAt <= saveStartedAt
            ? {
                ...document,
                dirty: false,
                lastSavedAt: result.savedAt,
                saveError: null,
              }
            : document,
        ),
        persistenceState: {
          status: 'saved',
          lastSavedAt: result.savedAt,
          lastError: null,
        },
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '后端保存失败，请稍后重试。';

      set((current) => ({
        browserSaveState: 'idle',
        documents: current.documents.map((document) =>
          document.dirty
            ? {
                ...document,
                saveError: message,
              }
            : document,
        ),
        persistenceState: {
          ...current.persistenceState,
          status: 'error',
          lastError: message,
        },
      }));
    } finally {
      saveInFlight = false;
      if (get().workspaceVersion > targetVersion) {
        saveWorkspaceSoon(get, set);
      }
    }
  },
}));
