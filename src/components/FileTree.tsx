import type {
  DocumentRecord,
  FolderRecord,
  TreeFolder,
} from '../types/workspace';
import { ROOT_FOLDER_ID } from '../types/workspace';
import { buildFolderForest, getRootDocuments } from '../lib/tree';
import {
  ChevronRightIcon,
  FileTextIcon,
  FolderIcon,
  TrashIcon,
} from './icons';

type FileTreeProps = {
  folders: FolderRecord[];
  documents: DocumentRecord[];
  activeDocumentId: string | null;
  animatedDocumentId: string | null;
  animatedFolderId: string | null;
  selectedFolderId: string | null;
  onOpenDocument: (documentId: string) => void;
  onToggleFolder: (folderId: string) => void;
  onSelectFolder: (folderId: string | null) => void;
  onDeleteDocument: (documentId: string) => void;
  onDeleteFolder: (folderId: string) => void;
};

type FolderNodeProps = {
  folder: TreeFolder;
  activeDocumentId: string | null;
  animatedDocumentId: string | null;
  animatedFolderId: string | null;
  selectedFolderId: string | null;
  onOpenDocument: (documentId: string) => void;
  onToggleFolder: (folderId: string) => void;
  onSelectFolder: (folderId: string) => void;
  onDeleteDocument: (documentId: string) => void;
  onDeleteFolder: (folderId: string) => void;
};

const FolderNode = ({
  folder,
  activeDocumentId,
  animatedDocumentId,
  animatedFolderId,
  selectedFolderId,
  onOpenDocument,
  onToggleFolder,
  onSelectFolder,
  onDeleteDocument,
  onDeleteFolder,
}: FolderNodeProps) => (
  <div className="tree-folder">
    <div
      className={`tree-entry ${
        selectedFolderId === folder.id ? 'is-selected' : ''
      } ${animatedFolderId === folder.id ? 'is-fresh' : ''}`}
    >
      <button
        className="tree-row tree-folder-row"
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
          <ChevronRightIcon width={14} height={14} />
        </span>
        <span className="tree-icon">
          <FolderIcon width={14} height={14} />
        </span>
        <span className="tree-name">{folder.name}</span>
      </button>

      <button
        className="tree-action"
        onClick={(event) => {
          event.stopPropagation();
          onDeleteFolder(folder.id);
        }}
        title="删除文件夹"
        type="button"
      >
        <TrashIcon width={14} height={14} />
      </button>
    </div>

    {folder.expanded ? (
      <div className="tree-children">
        {folder.childFolders.map((childFolder) => (
          <FolderNode
            key={childFolder.id}
            activeDocumentId={activeDocumentId}
            animatedDocumentId={animatedDocumentId}
            animatedFolderId={animatedFolderId}
            folder={childFolder}
            selectedFolderId={selectedFolderId}
            onOpenDocument={onOpenDocument}
            onDeleteDocument={onDeleteDocument}
            onDeleteFolder={onDeleteFolder}
            onSelectFolder={onSelectFolder}
            onToggleFolder={onToggleFolder}
          />
        ))}
        {folder.documents.map((document) => (
          <div
            key={document.id}
            className={`tree-entry ${
              activeDocumentId === document.id && selectedFolderId === null
                ? 'is-active'
                : ''
            } ${animatedDocumentId === document.id ? 'is-fresh' : ''}`}
          >
            <button
              className="tree-row tree-document-row"
              onClick={() => onOpenDocument(document.id)}
              type="button"
            >
              <span className="tree-caret is-placeholder" />
              <span className="tree-icon">
                <FileTextIcon width={14} height={14} />
              </span>
              <span className="tree-name">{document.title}</span>
              {document.remoteDirty ? <span className="tree-dirty-dot" /> : null}
            </button>
            <button
              className="tree-action"
              onClick={(event) => {
                event.stopPropagation();
                onDeleteDocument(document.id);
              }}
              title="删除文档"
              type="button"
            >
              <TrashIcon width={14} height={14} />
            </button>
          </div>
        ))}
      </div>
    ) : null}
  </div>
);

export const FileTree = ({
  folders,
  documents,
  activeDocumentId,
  animatedDocumentId,
  animatedFolderId,
  selectedFolderId,
  onOpenDocument,
  onToggleFolder,
  onSelectFolder,
  onDeleteDocument,
  onDeleteFolder,
}: FileTreeProps) => {
  const forest = buildFolderForest(folders, documents);
  const rootDocuments = getRootDocuments(folders, documents);

  return (
    <div className="file-tree">
      <div
        className={`tree-entry ${
          selectedFolderId === ROOT_FOLDER_ID ? 'is-selected' : ''
        }`}
      >
        <button
          className="tree-row tree-folder-row"
          onClick={() => onSelectFolder(null)}
          type="button"
        >
          <span className="tree-caret is-placeholder" />
          <span className="tree-icon">
            <FolderIcon width={14} height={14} />
          </span>
          <span className="tree-name">Workspace</span>
        </button>
      </div>

      <div className="tree-children">
        {forest.map((folder) => (
          <FolderNode
            key={folder.id}
            activeDocumentId={activeDocumentId}
            animatedDocumentId={animatedDocumentId}
            animatedFolderId={animatedFolderId}
            folder={folder}
            selectedFolderId={selectedFolderId}
            onOpenDocument={onOpenDocument}
            onDeleteDocument={onDeleteDocument}
            onDeleteFolder={onDeleteFolder}
            onSelectFolder={onSelectFolder}
            onToggleFolder={onToggleFolder}
          />
        ))}

        {rootDocuments.map((document) => (
          <div
            key={document.id}
            className={`tree-entry ${
              activeDocumentId === document.id && selectedFolderId === null
                ? 'is-active'
                : ''
            } ${animatedDocumentId === document.id ? 'is-fresh' : ''}`}
          >
            <button
              className="tree-row tree-document-row"
              onClick={() => onOpenDocument(document.id)}
              type="button"
            >
              <span className="tree-caret is-placeholder" />
              <span className="tree-icon">
                <FileTextIcon width={14} height={14} />
              </span>
              <span className="tree-name">{document.title}</span>
              {document.remoteDirty ? <span className="tree-dirty-dot" /> : null}
            </button>
            <button
              className="tree-action"
              onClick={(event) => {
                event.stopPropagation();
                onDeleteDocument(document.id);
              }}
              title="删除文档"
              type="button"
            >
              <TrashIcon width={14} height={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
