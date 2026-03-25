import type { DocumentRecord } from '../types/workspace';
import {
  PlusIcon,
} from './icons';

type TabBarProps = {
  openDocuments: DocumentRecord[];
  activeDocumentId: string | null;
  animatedDocumentId: string | null;
  onCreateDocument: () => void;
  onActivate: (documentId: string) => void;
  onClose: (documentId: string) => void;
};

export const TabBar = ({
  openDocuments,
  activeDocumentId,
  animatedDocumentId,
  onCreateDocument,
  onActivate,
  onClose,
}: TabBarProps) => {
  return (
    <div className="tab-bar">
      <div className="tab-strip" role="tablist" aria-label="打开的文档">
        {openDocuments.length === 0 ? (
          <div className="tab-empty">还没有打开的文档</div>
        ) : null}
        {openDocuments.map((document) => (
          <button
            key={document.id}
            className={`tab-item ${activeDocumentId === document.id ? 'is-active' : ''} ${
              animatedDocumentId === document.id ? 'is-fresh' : ''
            }`}
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
        <button
          className="tab-item tab-create-button"
          onClick={onCreateDocument}
          title="新建文档"
          type="button"
        >
          <PlusIcon width={15} height={15} />
        </button>
      </div>
    </div>
  );
};
