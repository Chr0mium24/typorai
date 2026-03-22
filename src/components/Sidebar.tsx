import { FileTree } from './FileTree';
import type { DocumentRecord, FolderRecord } from '../types/workspace';

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
  onOpenSettings: () => void;
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
  onOpenSettings,
  onCloseMobile,
}: SidebarProps) => (
  <>
    <aside
      className={`sidebar ${collapsed ? 'is-collapsed' : ''} ${
        mobileOpen ? 'is-mobile-open' : ''
      }`}
    >
      <div className="sidebar-header">
        <div>
          <p className="eyebrow">Writer Workspace</p>
          <h1>TyporAI</h1>
        </div>
        <button className="ghost-button" onClick={onToggleSidebar} type="button">
          {collapsed ? '展开' : '收起'}
        </button>
      </div>

      <div className="sidebar-actions">
        <button className="primary-button" onClick={onCreateDocument} type="button">
          新建文档
        </button>
        <button className="ghost-button" onClick={onCreateFolder} type="button">
          新建文件夹
        </button>
      </div>

      <div className="sidebar-tree">
        <FileTree
          activeDocumentId={activeDocumentId}
          documents={documents}
          folders={folders}
          selectedFolderId={selectedFolderId}
          onOpenDocument={(documentId) => {
            onOpenDocument(documentId);
            onCloseMobile();
          }}
          onSelectFolder={onSelectFolder}
          onToggleFolder={onToggleFolder}
        />
      </div>

      <div className="sidebar-footer">
        <button className="ghost-button" onClick={onOpenSettings} type="button">
          GitHub 设置
        </button>
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

