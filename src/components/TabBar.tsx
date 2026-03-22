import type { DocumentRecord } from '../types/workspace';

type TabBarProps = {
  openDocuments: DocumentRecord[];
  activeDocumentId: string | null;
  onActivate: (documentId: string) => void;
  onClose: (documentId: string) => void;
};

export const TabBar = ({
  openDocuments,
  activeDocumentId,
  onActivate,
  onClose,
}: TabBarProps) => (
  <div className="tab-bar" role="tablist" aria-label="打开的文档">
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
);

