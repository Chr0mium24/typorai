import { FileTree } from './FileTree';
import type { DocumentRecord, FolderRecord } from '../types/workspace';
import {
  FilePlusIcon,
  FolderPlusIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from './icons';

type SidebarProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  folders: FolderRecord[];
  documents: DocumentRecord[];
  activeDocumentId: string | null;
  selectedFolderId: string | null;
  onToggleSidebar: () => void;
  onCreateDocument: () => void;
  onCreateFolder: () => void;
  onOpenDocument: (documentId: string) => void;
  onToggleFolder: (folderId: string) => void;
  onSelectFolder: (folderId: string | null) => void;
  onDeleteDocument: (documentId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onCloseMobile: () => void;
};

export const Sidebar = ({
  collapsed,
  mobileOpen,
  folders,
  documents,
  activeDocumentId,
  selectedFolderId,
  onToggleSidebar,
  onCreateDocument,
  onCreateFolder,
  onOpenDocument,
  onToggleFolder,
  onSelectFolder,
  onDeleteDocument,
  onDeleteFolder,
  onCloseMobile,
}: SidebarProps) => {
  if (collapsed && !mobileOpen) {
    return (
      <aside className="sidebar is-collapsed">
        <div className="sidebar-rail">
          <button
            className="icon-button"
            onClick={onToggleSidebar}
            title="展开侧边栏"
            type="button"
          >
            <PanelLeftOpenIcon width={16} height={16} />
          </button>
          <button
            className="icon-button"
            onClick={onCreateDocument}
            title="新建文档"
            type="button"
          >
            <FilePlusIcon width={16} height={16} />
          </button>
          <button
            className="icon-button"
            onClick={onCreateFolder}
            title="新建文件夹"
            type="button"
          >
            <FolderPlusIcon width={16} height={16} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <>
      <aside
        className={`sidebar ${mobileOpen ? 'is-mobile-open' : ''}`}
      >
        <div className="sidebar-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h1>TyporAI</h1>
          </div>
          <button
            className="icon-button"
            onClick={onToggleSidebar}
            title="收起侧边栏"
            type="button"
          >
            <PanelLeftCloseIcon width={16} height={16} />
          </button>
        </div>

        <div className="sidebar-actions">
          <button
            className="icon-button"
            onClick={onCreateDocument}
            title="新建文档"
            type="button"
          >
            <FilePlusIcon width={16} height={16} />
          </button>
          <button
            className="icon-button"
            onClick={onCreateFolder}
            title="新建文件夹"
            type="button"
          >
            <FolderPlusIcon width={16} height={16} />
          </button>
        </div>

        <div className="sidebar-tree">
          <FileTree
            activeDocumentId={activeDocumentId}
            documents={documents}
            folders={folders}
            selectedFolderId={selectedFolderId}
            onDeleteDocument={onDeleteDocument}
            onDeleteFolder={onDeleteFolder}
            onOpenDocument={(documentId) => {
              onOpenDocument(documentId);
              onCloseMobile();
            }}
            onSelectFolder={onSelectFolder}
            onToggleFolder={onToggleFolder}
          />
        </div>
      </aside>

      {mobileOpen ? (
        <button
          className="mobile-backdrop"
          onClick={onCloseMobile}
          type="button"
          aria-label="关闭文件面板"
        />
      ) : null}
    </>
  );
};
