import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
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

const getMarkdownFilename = (title: string, slug: string) => {
  const sanitized = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/, '');

  const baseName = sanitized || slug || 'untitled';
  return baseName.toLowerCase().endsWith('.md') ? baseName : `${baseName}.md`;
};

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [animatedDocumentId, setAnimatedDocumentId] = useState<string | null>(null);
  const [animatedFolderId, setAnimatedFolderId] = useState<string | null>(null);
  const dragDepthRef = useRef(0);
  const animationTimerRef = useRef<{
    document?: number;
    folder?: number;
  }>({});

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
    deleteDocument,
    deleteFolder,
    importMarkdownFiles,
    openDocument,
    closeDocument,
    setActiveDocument,
    setEditorMode,
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

  useEffect(
    () => () => {
      if (animationTimerRef.current.document) {
        window.clearTimeout(animationTimerRef.current.document);
      }
      if (animationTimerRef.current.folder) {
        window.clearTimeout(animationTimerRef.current.folder);
      }
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;

      if (event.key === '/') {
        event.preventDefault();
        setEditorMode(session.editorMode === 'source' ? 'wysiwyg' : 'source');
        return;
      }

      if (event.key.toLowerCase() === 'w') {
        if (!session.activeDocumentId) return;
        event.preventDefault();
        closeDocument(session.activeDocumentId);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    closeDocument,
    session.activeDocumentId,
    session.editorMode,
    setEditorMode,
  ]);

  useEffect(() => {
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setDropActive(true);
    };

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
      setDropActive(true);
    };

    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current = Math.max(dragDepthRef.current - 1, 0);
      if (dragDepthRef.current === 0) {
        setDropActive(false);
      }
    };

    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setDropActive(false);

      const droppedFiles = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
        file.name.toLowerCase().endsWith('.md'),
      );

      if (droppedFiles.length === 0) return;

      void Promise.all(
        droppedFiles.map(async (file) => ({
          name: file.name,
          markdown: await file.text(),
        })),
      ).then((files) => importMarkdownFiles(files));
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [importMarkdownFiles]);

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

  const animateFreshItem = (type: 'document' | 'folder', id: string) => {
    const timerKey = type === 'document' ? 'document' : 'folder';
    const setter = type === 'document' ? setAnimatedDocumentId : setAnimatedFolderId;
    const existingTimer = animationTimerRef.current[timerKey];

    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }

    setter(id);
    animationTimerRef.current[timerKey] = window.setTimeout(() => {
      setter((current) => (current === id ? null : current));
      animationTimerRef.current[timerKey] = undefined;
    }, 900);
  };

  const handleCreateDocument = (title = 'Untitled note') => {
    const documentId = createDocument(title);
    animateFreshItem('document', documentId);
  };

  const handleCreateFolder = (name: string) => {
    const folderId = createFolder(name);
    animateFreshItem('folder', folderId);
  };

  const exportActiveDocument = () => {
    if (!activeDocument) return;

    const blob = new Blob([activeDocument.markdown], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = window.URL.createObjectURL(blob);
    const link = window.document.createElement('a');

    link.href = url;
    link.download = getMarkdownFilename(activeDocument.title, activeDocument.slug);
    window.document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  if (!hydrated) {
    return (
      <div className="app-loading">
        <p className="eyebrow">Loading workspace</p>
        <h1>正在恢复你的写作现场...</h1>
      </div>
    );
  }

  return (
    <div className="app-frame">
      <div
        className={`app-shell ${
          session.sidebarCollapsed ? 'is-sidebar-collapsed' : ''
        }`}
      >
        <Sidebar
          activeDocumentId={session.activeDocumentId}
          animatedDocumentId={animatedDocumentId}
          animatedFolderId={animatedFolderId}
          collapsed={session.sidebarCollapsed}
          documents={documents}
          folders={folders}
          mobileOpen={mobileSidebarOpen}
          selectedFolderId={session.selectedFolderId}
          onCloseMobile={() => setMobileSidebarOpen(false)}
          onCreateFolder={() => {
            const name = promptForName('新文件夹名称', 'New folder');
            if (name) handleCreateFolder(name);
          }}
          onDeleteDocument={(documentId) => {
            const target = documents.find((document) => document.id === documentId);
            if (!target) return;
            if (!window.confirm(`删除文档「${target.title}」？`)) return;
            void deleteDocument(documentId);
          }}
          onDeleteFolder={(folderId) => {
            const target = folders.find((folder) => folder.id === folderId);
            if (!target) return;
            if (!window.confirm(`删除文件夹「${target.name}」及其内容？`)) return;
            void deleteFolder(folderId);
          }}
          onOpenDocument={openDocument}
          onSelectFolder={setSelectedFolder}
          onToggleFolder={toggleFolderExpanded}
        />

        <main className="workspace-main">
          <TabBar
            activeDocumentId={session.activeDocumentId}
            animatedDocumentId={animatedDocumentId}
            browserSaveState={browserSaveState}
            lastBrowserSaveAt={lastBrowserSaveAt}
            mode={session.editorMode}
            openDocuments={openDocuments}
            onCreateDocument={() => {
              const name = promptForName('新文档标题', 'Untitled note');
              handleCreateDocument(name || 'Untitled note');
            }}
            onActivate={setActiveDocument}
            onClose={closeDocument}
            onExportDocument={exportActiveDocument}
            exportDisabled={!activeDocument}
            onOpenSettings={() => setSettingsOpen(true)}
            onSyncNow={() => void syncNow()}
            onToggleMode={() =>
              setEditorMode(
                session.editorMode === 'source' ? 'wysiwyg' : 'source',
              )
            }
            onToggleSidebar={() => {
              if (window.innerWidth <= 1100) {
                setMobileSidebarOpen(true);
                return;
              }
              toggleSidebar();
            }}
            sidebarCollapsed={session.sidebarCollapsed}
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
              createdDocumentId={animatedDocumentId}
              document={activeDocument}
              folders={folders}
              mode={session.editorMode}
              onChangeMarkdown={(markdown) => {
                if (!activeDocument) return;
                updateDocumentMarkdown(activeDocument.id, markdown);
              }}
              onChangeTitle={(title) => {
                if (!activeDocument) return;
                updateDocumentTitle(activeDocument.id, title);
              }}
              onCreateDocument={() => handleCreateDocument('Untitled note')}
            />
          </Suspense>

          <StatusBar
            dirtyDocumentCount={dirtyDocumentCount}
            syncState={syncState}
          />
        </main>

        <SettingsPanel
          open={settingsOpen}
          settings={githubSettings}
          onClose={() => setSettingsOpen(false)}
          onSave={updateGithubSettings}
        />
      </div>

      {dropActive ? (
        <div className="drop-overlay">
          <div className="drop-overlay-card">
            <p className="eyebrow">Import Markdown</p>
            <h2>拖到这里导入到当前文件夹</h2>
            <p>仅接受 `.md` 文件。</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
