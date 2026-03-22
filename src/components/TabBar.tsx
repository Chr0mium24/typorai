import type { DocumentRecord } from '../types/workspace';
import { FilePlusIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from './icons';

type TabBarProps = {
  openDocuments: DocumentRecord[];
  activeDocumentId: string | null;
  sidebarCollapsed: boolean;
  onCreateDocument: () => void;
  onActivate: (documentId: string) => void;
  onClose: (documentId: string) => void;
  onToggleSidebar: () => void;
};

export const TabBar = ({
  openDocuments,
  activeDocumentId,
  sidebarCollapsed,
  onCreateDocument,
  onActivate,
  onClose,
  onToggleSidebar,
}: TabBarProps) => (
  <div className="tab-bar" role="tablist" aria-label="打开的文档">
    <div className="tab-controls">
      <button
        className="icon-button"
        onClick={onToggleSidebar}
        title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        type="button"
      >
        {sidebarCollapsed ? (
          <PanelLeftOpenIcon width={16} height={16} />
        ) : (
          <PanelLeftCloseIcon width={16} height={16} />
        )}
      </button>
      <button
        className="icon-button"
        onClick={onCreateDocument}
        title="新建文档"
        type="button"
      >
        <FilePlusIcon width={16} height={16} />
      </button>
    </div>

    <div className="tab-strip">
      {openDocuments.length === 0 ? (
        <div className="tab-empty">还没有打开的文档</div>
      ) : null}
      {openDocuments.map((document) => (
        <button
          key={document.id}
          className={`tab-item ${activeDocumentId === document.id ? 'is-active' : ''}`}
          onClick={() => onActivate(document.id)}
          type="button"
        >
          <span className="tab-title">{document.title}</span>
          {document.remoteDirty ? <span className="tab-dot" /> : null}
          <span
            className="tab-close"
            onClick={(event) => {
              event.stopPropagation();
              onClose(document.id);
            }}
            role="presentation"
          >
            ×
          </span>
        </button>
      ))}
    </div>
  </div>
);
