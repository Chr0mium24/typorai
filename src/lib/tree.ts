import type {
  DocumentRecord,
  FolderRecord,
  TreeFolder,
} from '../types/workspace';

export const sortByName = <T extends { name?: string; title?: string }>(
  left: T,
  right: T,
) => {
  const a = left.name ?? left.title ?? '';
  const b = right.name ?? right.title ?? '';
  return a.localeCompare(b, 'zh-CN');
};

export const buildFolderForest = (
  folders: FolderRecord[],
  documents: DocumentRecord[],
): TreeFolder[] => {
  const folderMap = new Map<string, TreeFolder>();

  folders.forEach((folder) => {
    folderMap.set(folder.id, {
      ...folder,
      childFolders: [],
      documents: [],
    });
  });

  documents.forEach((document) => {
    if (document.parentFolderId && folderMap.has(document.parentFolderId)) {
      folderMap.get(document.parentFolderId)?.documents.push(document);
    }
  });

  const roots: TreeFolder[] = [];

  folderMap.forEach((folder) => {
    if (folder.parentId && folderMap.has(folder.parentId)) {
      folderMap.get(folder.parentId)?.childFolders.push(folder);
      return;
    }
    roots.push(folder);
  });

  const sortTree = (tree: TreeFolder[]) => {
    tree.sort(sortByName);
    tree.forEach((node) => {
      node.childFolders.sort(sortByName);
      node.documents.sort(sortByName);
      sortTree(node.childFolders);
    });
  };

  sortTree(roots);

  return roots;
};

export const getRootDocuments = (
  folders: FolderRecord[],
  documents: DocumentRecord[],
) => {
  const folderIds = new Set(folders.map((folder) => folder.id));
  return documents
    .filter(
      (document) =>
        document.parentFolderId === null ||
        !folderIds.has(document.parentFolderId),
    )
    .sort(sortByName);
};

export const getFolderPath = (
  folderId: string | null,
  folders: FolderRecord[],
): string[] => {
  if (!folderId) return [];

  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const result: string[] = [];
  let current = byId.get(folderId) ?? null;

  while (current) {
    result.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) ?? null : null;
  }

  return result;
};

