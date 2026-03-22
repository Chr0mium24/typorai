import { create } from 'zustand';
import {
  deleteDocuments,
  deleteFolders,
  loadWorkspaceSnapshot,
  persistDocument,
  persistFolders,
  persistGithubSettings,
  persistSession,
} from '../lib/db';
import {
  createDocumentRecord,
  createFolderRecord,
} from '../lib/default-workspace';
import {
  isGithubConfigured,
  syncDocumentToGithub,
} from '../lib/github';
import type {
  DocumentRecord,
  FolderRecord,
  GithubSettings,
  SyncState,
  WorkspaceSession,
} from '../types/workspace';
import {
  defaultGithubSettings,
  defaultWorkspaceSession,
} from '../types/workspace';

const LOCAL_SAVE_DELAY_MS = 500;
const REMOTE_SYNC_DELAY_MS = 5 * 60 * 1000;
const REMOTE_SYNC_POLL_MS = 15 * 1000;

const documentSaveTimers = new Map<string, number>();
let sessionSaveTimer: number | undefined;
let remoteSyncTimer: number | undefined;
let syncLoopStarted = false;
let remoteSyncInFlight = false;

const nowIso = () => new Date().toISOString();

const getEarliestPendingSync = (documents: DocumentRecord[]) => {
  const timestamps = documents
    .filter((document) => document.remoteDirty && document.pendingSyncSince)
    .map((document) => new Date(document.pendingSyncSince ?? '').getTime())
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) return undefined;
  return new Date(Math.min(...timestamps) + REMOTE_SYNC_DELAY_MS).toISOString();
};

const saveSessionSoon = (
  get: () => WorkspaceStore,
  set: (
    partial:
      | Partial<WorkspaceStore>
      | ((state: WorkspaceStore) => Partial<WorkspaceStore>),
  ) => void,
) => {
  if (sessionSaveTimer) {
    window.clearTimeout(sessionSaveTimer);
  }

  sessionSaveTimer = window.setTimeout(async () => {
    await persistSession(get().session);
    set({ lastSessionPersistAt: nowIso() });
  }, 200);
};

const saveDocumentSoon = (
  documentId: string,
  get: () => WorkspaceStore,
  set: (
    partial:
      | Partial<WorkspaceStore>
      | ((state: WorkspaceStore) => Partial<WorkspaceStore>),
  ) => void,
) => {
  set({ browserSaveState: 'saving' });

  const existing = documentSaveTimers.get(documentId);
  if (existing) {
    window.clearTimeout(existing);
  }

  const timer = window.setTimeout(async () => {
    const document = get().documents.find((item) => item.id === documentId);
    if (!document) return;

    const savedAt = nowIso();
    await persistDocument({
      ...document,
      lastLocalSaveAt: savedAt,
    });

    set((state) => ({
      browserSaveState: 'saved',
      lastBrowserSaveAt: savedAt,
      documents: state.documents.map((item) =>
        item.id === documentId ? { ...item, lastLocalSaveAt: savedAt } : item,
      ),
    }));
  }, LOCAL_SAVE_DELAY_MS);

  documentSaveTimers.set(documentId, timer);
};

const scheduleRemoteSync = (
  get: () => WorkspaceStore,
  set: (
    partial:
      | Partial<WorkspaceStore>
      | ((state: WorkspaceStore) => Partial<WorkspaceStore>),
  ) => void,
  force = false,
) => {
  if (remoteSyncTimer) {
    window.clearTimeout(remoteSyncTimer);
    remoteSyncTimer = undefined;
  }

  const state = get();
  const dirtyDocuments = state.documents.filter((document) => document.remoteDirty);

  if (dirtyDocuments.length === 0) {
    set((current) => ({
      syncState: {
        ...current.syncState,
        status: 'idle',
        nextSyncAt: undefined,
        lastError: null,
      },
    }));
    return;
  }

  if (!isGithubConfigured(state.githubSettings)) {
    set((current) => ({
      syncState: {
        ...current.syncState,
        status: 'setup-required',
        nextSyncAt: undefined,
      },
    }));
    return;
  }

  const nextSyncAt = force ? nowIso() : getEarliestPendingSync(dirtyDocuments);
  if (!nextSyncAt) return;

  const waitMs = Math.max(new Date(nextSyncAt).getTime() - Date.now(), 0);

  set((current) => ({
    syncState: {
      ...current.syncState,
      status: 'queued',
      nextSyncAt,
      lastError: null,
    },
  }));

  remoteSyncTimer = window.setTimeout(() => {
    void get().syncDirtyDocuments();
  }, waitMs);
};

const startSyncLoop = (
  get: () => WorkspaceStore,
  set: (
    partial:
      | Partial<WorkspaceStore>
      | ((state: WorkspaceStore) => Partial<WorkspaceStore>),
  ) => void,
) => {
  if (syncLoopStarted) return;
  syncLoopStarted = true;

  window.setInterval(() => {
    const state = get();
    const dueAt = state.syncState.nextSyncAt
      ? new Date(state.syncState.nextSyncAt).getTime()
      : undefined;

    if (dueAt && dueAt <= Date.now()) {
      void get().syncDirtyDocuments();
      return;
    }

    if (state.documents.some((document) => document.remoteDirty)) {
      scheduleRemoteSync(get, set);
    }
  }, REMOTE_SYNC_POLL_MS);
};

const resolveParentFolderId = (
  explicitFolderId: string | null | undefined,
  session: WorkspaceSession,
  documents: DocumentRecord[],
) => {
  if (explicitFolderId !== undefined) return explicitFolderId;
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

const clearDocumentTimer = (documentId: string) => {
  const timer = documentSaveTimers.get(documentId);
  if (timer) {
    window.clearTimeout(timer);
    documentSaveTimers.delete(documentId);
  }
};

type BrowserSaveState = 'idle' | 'saving' | 'saved';

export type WorkspaceStore = {
  hydrated: boolean;
  documents: DocumentRecord[];
  folders: FolderRecord[];
  session: WorkspaceSession;
  githubSettings: GithubSettings;
  syncState: SyncState;
  browserSaveState: BrowserSaveState;
  lastBrowserSaveAt?: string;
  lastSessionPersistAt?: string;
  initialize: () => Promise<void>;
  createDocument: (title?: string, parentFolderId?: string | null) => void;
  createFolder: (name: string, parentFolderId?: string | null) => void;
  deleteDocument: (documentId: string) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  openDocument: (documentId: string) => void;
  closeDocument: (documentId: string) => void;
  setActiveDocument: (documentId: string) => void;
  setSelectedFolder: (folderId: string | null) => void;
  setEditorMode: (mode: WorkspaceSession['editorMode']) => void;
  updateDocumentTitle: (documentId: string, title: string) => void;
  updateDocumentMarkdown: (documentId: string, markdown: string) => void;
  toggleFolderExpanded: (folderId: string) => void;
  toggleSidebar: () => void;
  updateGithubSettings: (settings: GithubSettings) => Promise<void>;
  syncDirtyDocuments: () => Promise<void>;
  syncNow: () => Promise<void>;
  flushLocalPersistence: () => Promise<void>;
};

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  hydrated: false,
  documents: [],
  folders: [],
  session: defaultWorkspaceSession,
  githubSettings: defaultGithubSettings,
  syncState: { status: 'idle', lastError: null },
  browserSaveState: 'idle',
  lastBrowserSaveAt: undefined,
  lastSessionPersistAt: undefined,

  initialize: async () => {
    if (get().hydrated) return;

    const snapshot = await loadWorkspaceSnapshot();

    set({
      hydrated: true,
      documents: snapshot.documents,
      folders: snapshot.folders,
      session: snapshot.session,
      githubSettings: snapshot.githubSettings,
      syncState: {
        status: isGithubConfigured(snapshot.githubSettings)
          ? snapshot.documents.some((document) => document.remoteDirty)
            ? 'queued'
            : 'idle'
          : snapshot.documents.some((document) => document.remoteDirty)
            ? 'setup-required'
            : 'idle',
        nextSyncAt: getEarliestPendingSync(snapshot.documents),
        lastError: null,
      },
      browserSaveState: 'saved',
    });

    startSyncLoop(get, set);
    scheduleRemoteSync(get, set);
  },

  createDocument: (title = 'Untitled note', parentFolderId) => {
    const state = get();
    const resolvedParent = resolveParentFolderId(
      parentFolderId,
      state.session,
      state.documents,
    );
    const document = createDocumentRecord(title, resolvedParent);

    set((current) => ({
      documents: [...current.documents, document],
      session: {
        ...current.session,
        selectedFolderId: resolvedParent,
        activeDocumentId: document.id,
        openDocumentIds: Array.from(
          new Set([...current.session.openDocumentIds, document.id]),
        ),
      },
      browserSaveState: 'saving',
    }));

    saveDocumentSoon(document.id, get, set);
    saveSessionSoon(get, set);
    scheduleRemoteSync(get, set);
  },

  createFolder: (name, parentFolderId) => {
    const state = get();
    const resolvedParent = resolveParentFolderId(
      parentFolderId,
      state.session,
      state.documents,
    );
    const folder = createFolderRecord(name, resolvedParent);

    set((current) => ({
      folders: [...current.folders, folder],
      session: {
        ...current.session,
        selectedFolderId: folder.id,
      },
    }));

    void persistFolders([folder]);
    saveSessionSoon(get, set);
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

    clearDocumentTimer(documentId);

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
    });

    await Promise.all([deleteDocuments([documentId]), persistSession(get().session)]);
    scheduleRemoteSync(get, set);
  },

  deleteFolder: async (folderId) => {
    const state = get();
    const targetFolder = state.folders.find((folder) => folder.id === folderId);
    if (!targetFolder) return;

    const folderIds = collectFolderIds(folderId, state.folders);
    const documentIds = state.documents
      .filter((document) => document.parentFolderId && folderIds.has(document.parentFolderId))
      .map((document) => document.id);

    documentIds.forEach(clearDocumentTimer);

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
    });

    await Promise.all([
      deleteDocuments(documentIds),
      deleteFolders(Array.from(folderIds)),
      persistSession(get().session),
    ]);
    scheduleRemoteSync(get, set);
  },

  openDocument: (documentId) => {
    const state = get();
    const exists = state.documents.some((document) => document.id === documentId);
    if (!exists) return;

    set((current) => ({
      session: {
        ...current.session,
        activeDocumentId: documentId,
        openDocumentIds: Array.from(
          new Set([...current.session.openDocumentIds, documentId]),
        ),
      },
    }));

    saveSessionSoon(get, set);
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

    set((current) => ({
      session: {
        ...current.session,
        openDocumentIds,
        activeDocumentId: nextActiveDocumentId,
      },
    }));

    saveSessionSoon(get, set);
  },

  setActiveDocument: (documentId) => {
    const documentExists = get().documents.some((item) => item.id === documentId);
    if (!documentExists) return;

    set((current) => ({
      session: {
        ...current.session,
        activeDocumentId: documentId,
      },
    }));

    saveSessionSoon(get, set);
  },

  setSelectedFolder: (folderId) => {
    set((current) => ({
      session: {
        ...current.session,
        selectedFolderId: folderId,
      },
    }));

    saveSessionSoon(get, set);
  },

  setEditorMode: (mode) => {
    set((current) => ({
      session: {
        ...current.session,
        editorMode: mode,
      },
    }));

    saveSessionSoon(get, set);
  },

  updateDocumentTitle: (documentId, title) => {
    const trimmedTitle = title.trim() || 'Untitled note';
    const timestamp = nowIso();

    set((state) => ({
      documents: state.documents.map((document) =>
        document.id === documentId
          ? {
              ...document,
              title: trimmedTitle,
              updatedAt: timestamp,
              remoteDirty: true,
              pendingSyncSince: document.pendingSyncSince ?? timestamp,
              syncError: null,
            }
          : document,
      ),
    }));

    saveDocumentSoon(documentId, get, set);
    scheduleRemoteSync(get, set);
  },

  updateDocumentMarkdown: (documentId, markdown) => {
    const timestamp = nowIso();

    set((state) => ({
      documents: state.documents.map((document) =>
        document.id === documentId
          ? {
              ...document,
              markdown,
              updatedAt: timestamp,
              remoteDirty: true,
              pendingSyncSince: document.pendingSyncSince ?? timestamp,
              syncError: null,
            }
          : document,
      ),
    }));

    saveDocumentSoon(documentId, get, set);
    scheduleRemoteSync(get, set);
  },

  toggleFolderExpanded: (folderId) => {
    let updatedFolder: FolderRecord | undefined;

    set((state) => ({
      folders: state.folders.map((folder) => {
        if (folder.id !== folderId) return folder;
        updatedFolder = {
          ...folder,
          expanded: !folder.expanded,
          updatedAt: nowIso(),
        };
        return updatedFolder;
      }),
    }));

    if (updatedFolder) {
      void persistFolders([updatedFolder]);
    }
  },

  toggleSidebar: () => {
    set((state) => ({
      session: {
        ...state.session,
        sidebarCollapsed: !state.session.sidebarCollapsed,
      },
    }));

    saveSessionSoon(get, set);
  },

  updateGithubSettings: async (settings) => {
    set({ githubSettings: settings });
    await persistGithubSettings(settings);
    scheduleRemoteSync(get, set);
  },

  syncDirtyDocuments: async () => {
    const state = get();
    const dirtyDocuments = state.documents
      .filter((document) => document.remoteDirty)
      .sort((left, right) =>
        (left.pendingSyncSince ?? '').localeCompare(right.pendingSyncSince ?? ''),
      );

    if (dirtyDocuments.length === 0) {
      set((current) => ({
        syncState: {
          ...current.syncState,
          status: 'idle',
          nextSyncAt: undefined,
        },
      }));
      return;
    }

    if (!isGithubConfigured(state.githubSettings)) {
      set((current) => ({
        syncState: {
          ...current.syncState,
          status: 'setup-required',
          nextSyncAt: undefined,
          lastError: '请先填写 GitHub 仓库配置后再同步。',
        },
      }));
      return;
    }

    if (remoteSyncInFlight) return;
    remoteSyncInFlight = true;

    set((current) => ({
      syncState: {
        ...current.syncState,
        status: 'syncing',
        lastError: null,
      },
    }));

    try {
      for (const document of dirtyDocuments) {
        const result = await syncDocumentToGithub(
          document,
          get().folders,
          get().githubSettings,
        );
        const syncedAt = nowIso();

        set((current) => ({
          documents: current.documents.map((item) =>
            item.id === document.id
              ? {
                  ...item,
                  remoteSha: result.sha,
                  remoteDirty: false,
                  lastRemoteSyncAt: syncedAt,
                  pendingSyncSince: undefined,
                  syncError: null,
                }
              : item,
          ),
          syncState: {
            ...current.syncState,
            lastSyncAt: syncedAt,
            lastError: null,
          },
        }));

        const updatedDocument = get().documents.find((item) => item.id === document.id);
        if (updatedDocument) {
          await persistDocument(updatedDocument);
        }
      }

      scheduleRemoteSync(get, set);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '远端同步失败，请稍后重试。';

      set((current) => ({
        syncState: {
          ...current.syncState,
          status: 'error',
          lastError: message,
        },
        documents: current.documents.map((document) =>
          document.remoteDirty
            ? {
                ...document,
                syncError: message,
              }
            : document,
        ),
      }));
    } finally {
      remoteSyncInFlight = false;
      scheduleRemoteSync(get, set);
    }
  },

  syncNow: async () => {
    scheduleRemoteSync(get, set, true);
    await get().syncDirtyDocuments();
  },

  flushLocalPersistence: async () => {
    const state = get();
    const savedAt = nowIso();

    await Promise.all([
      ...state.documents.map((document) =>
        persistDocument({
          ...document,
          lastLocalSaveAt: savedAt,
        }),
      ),
      persistSession(state.session),
      persistFolders(state.folders),
      persistGithubSettings(state.githubSettings),
    ]);

    set((current) => ({
      browserSaveState: 'saved',
      lastBrowserSaveAt: savedAt,
      documents: current.documents.map((document) => ({
        ...document,
        lastLocalSaveAt: savedAt,
      })),
    }));
  },
}));
