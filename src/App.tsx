import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { StatusBar } from './components/StatusBar';
import { SettingsPanel } from './components/SettingsPanel';
import { useWorkspaceStore } from './store/workspace-store';

const EditorPane = lazy(() => import('./components/EditorPane'));

const promptForName = (label: string, fallback: string) => {
  const value = window.prompt(label, fallback);
  return value?.trim() ?? '';
};

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const {
    hydrated,
    documents,
    folders,
    session,
    githubSettings,
    syncState,
    browserSaveState,
    lastBrowserSaveAt,
    initialize,
    createDocument,
    createFolder,
    openDocument,
    closeDocument,
    setActiveDocument,
    setSelectedFolder,
    updateDocumentTitle,
    updateDocumentMarkdown,
    toggleFolderExpanded,
    toggleSidebar,
    updateGithubSettings,
    syncNow,
    flushLocalPersistence,
  } = useWorkspaceStore();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    const flush = () => {
      void flushLocalPersistence();
    };

    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [flushLocalPersistence]);

  const activeDocument =
    documents.find((document) => document.id === session.activeDocumentId) ?? null;

  const openDocuments = useMemo(
    () =>
      session.openDocumentIds
        .map((id) => documents.find((document) => document.id === id) ?? null)
        .filter((document): document is NonNullable<typeof document> => Boolean(document)),
    [documents, session.openDocumentIds],
  );

  const dirtyDocumentCount = documents.filter((document) => document.remoteDirty).length;

  if (!hydrated) {
    return (
      <div className="app-loading">
        <p className="eyebrow">Loading workspace</p>
        <h1>正在恢复你的写作现场...</h1>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeDocumentId={session.activeDocumentId}
        collapsed={session.sidebarCollapsed}
        documents={documents}
        folders={folders}
        mobileOpen={mobileSidebarOpen}
        selectedFolderId={session.selectedFolderId}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onCreateDocument={() => {
          const name = promptForName('新文档标题', 'Untitled note');
          createDocument(name || 'Untitled note');
        }}
        onCreateFolder={() => {
          const name = promptForName('新文件夹名称', 'New folder');
          if (name) createFolder(name);
        }}
        onOpenDocument={openDocument}
        onOpenSettings={() => setSettingsOpen(true)}
        onSelectFolder={setSelectedFolder}
        onToggleFolder={toggleFolderExpanded}
        onToggleSidebar={toggleSidebar}
      />

      <main className="workspace-main">
        <header className="workspace-toolbar">
          <div className="toolbar-left">
            <button
              className="ghost-button mobile-only"
              onClick={() => setMobileSidebarOpen(true)}
              type="button"
            >
              文件
            </button>
            <div>
              <p className="eyebrow">Local-first Markdown Studio</p>
              <h2>{activeDocument?.title ?? 'TyporAI'}</h2>
            </div>
          </div>

          <div className="toolbar-actions">
            <button
              className="ghost-button desktop-only"
              onClick={() => setSettingsOpen(true)}
              type="button"
            >
              GitHub 设置
            </button>
            <button className="primary-button" onClick={() => void syncNow()} type="button">
              立即同步
            </button>
          </div>
        </header>

        <TabBar
          activeDocumentId={session.activeDocumentId}
          openDocuments={openDocuments}
          onActivate={setActiveDocument}
          onClose={closeDocument}
        />

        <Suspense
          fallback={
            <section className="editor-empty">
              <p className="eyebrow">Loading editor</p>
              <h2>正在载入编辑器...</h2>
            </section>
          }
        >
          <EditorPane
            document={activeDocument}
            folders={folders}
            onChangeMarkdown={(markdown) => {
              if (!activeDocument) return;
              updateDocumentMarkdown(activeDocument.id, markdown);
            }}
            onChangeTitle={(title) => {
              if (!activeDocument) return;
              updateDocumentTitle(activeDocument.id, title);
            }}
            onCreateDocument={() => createDocument('Untitled note')}
          />
        </Suspense>

        <StatusBar
          browserSaveState={browserSaveState}
          dirtyDocumentCount={dirtyDocumentCount}
          lastBrowserSaveAt={lastBrowserSaveAt}
          syncState={syncState}
          onSyncNow={syncNow}
        />
      </main>

      <SettingsPanel
        open={settingsOpen}
        settings={githubSettings}
        onClose={() => setSettingsOpen(false)}
        onSave={updateGithubSettings}
      />
    </div>
  );
}

export default App;
