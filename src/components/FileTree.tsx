import type {
  DocumentRecord,
  FolderRecord,
  TreeFolder,
} from '../types/workspace';
import { buildFolderForest, getRootDocuments } from '../lib/tree';

type FileTreeProps = {
  folders: FolderRecord[];
  documents: DocumentRecord[];
  activeDocumentId: string | null;
  selectedFolderId: string | null;
  onOpenDocument: (documentId: string) => void;
  onToggleFolder: (folderId: string) => void;
  onSelectFolder: (folderId: string | null) => void;
};

type FolderNodeProps = {
  folder: TreeFolder;
  activeDocumentId: string | null;
  selectedFolderId: string | null;
  onOpenDocument: (documentId: string) => void;
  onToggleFolder: (folderId: string) => void;
  onSelectFolder: (folderId: string) => void;
};

const FolderNode = ({
  folder,
  activeDocumentId,
  selectedFolderId,
  onOpenDocument,
  onToggleFolder,
  onSelectFolder,
}: FolderNodeProps) => (
  <div className="tree-folder">
    <button
      className={`tree-row tree-folder-row ${
        selectedFolderId === folder.id ? 'is-selected' : ''
      }`}
      onClick={() => onSelectFolder(folder.id)}
      type="button"
    >
      <span
        className={`tree-caret ${folder.expanded ? 'is-open' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggleFolder(folder.id);
        }}
      >
        ▸
      </span>
      <span className="tree-icon">◻</span>
      <span className="tree-name">{folder.name}</span>
    </button>

    {folder.expanded ? (
      <div className="tree-children">
        {folder.childFolders.map((childFolder) => (
          <FolderNode
            key={childFolder.id}
            activeDocumentId={activeDocumentId}
            folder={childFolder}
            selectedFolderId={selectedFolderId}
            onOpenDocument={onOpenDocument}
            onSelectFolder={onSelectFolder}
            onToggleFolder={onToggleFolder}
          />
        ))}
        {folder.documents.map((document) => (
          <button
            key={document.id}
            className={`tree-row tree-document-row ${
              activeDocumentId === document.id ? 'is-active' : ''
            }`}
            onClick={() => onOpenDocument(document.id)}
            type="button"
          >
            <span className="tree-caret is-placeholder" />
            <span className="tree-icon">✦</span>
            <span className="tree-name">{document.title}</span>
            {document.remoteDirty ? <span className="tree-dirty-dot" /> : null}
          </button>
        ))}
      </div>
    ) : null}
  </div>
);

export const FileTree = ({
  folders,
  documents,
  activeDocumentId,
  selectedFolderId,
  onOpenDocument,
  onToggleFolder,
  onSelectFolder,
}: FileTreeProps) => {
  const forest = buildFolderForest(folders, documents);
  const rootDocuments = getRootDocuments(folders, documents);

  return (
    <div className="file-tree">
      <button
        className={`tree-row tree-folder-row ${
          selectedFolderId === null ? 'is-selected' : ''
        }`}
        onClick={() => onSelectFolder(null)}
        type="button"
      >
        <span className="tree-caret is-placeholder" />
        <span className="tree-icon">⌂</span>
        <span className="tree-name">Workspace</span>
      </button>

      <div className="tree-children">
        {forest.map((folder) => (
          <FolderNode
            key={folder.id}
            activeDocumentId={activeDocumentId}
            folder={folder}
            selectedFolderId={selectedFolderId}
            onOpenDocument={onOpenDocument}
            onSelectFolder={onSelectFolder}
            onToggleFolder={onToggleFolder}
          />
        ))}

        {rootDocuments.map((document) => (
          <button
            key={document.id}
            className={`tree-row tree-document-row ${
              activeDocumentId === document.id ? 'is-active' : ''
            }`}
            onClick={() => onOpenDocument(document.id)}
            type="button"
          >
            <span className="tree-caret is-placeholder" />
            <span className="tree-icon">✦</span>
            <span className="tree-name">{document.title}</span>
            {document.remoteDirty ? <span className="tree-dirty-dot" /> : null}
          </button>
        ))}
      </div>
    </div>
  );
};

