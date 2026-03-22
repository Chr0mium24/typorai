import type {
  DocumentRecord,
  FolderRecord,
  GithubSettings,
} from '../types/workspace';
import { getFolderPath } from './tree';

const sanitizePathSegment = (value: string) =>
  value
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

const encodeBase64 = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const buildRemotePath = (
  document: DocumentRecord,
  folders: FolderRecord[],
  contentRoot: string,
) => {
  const folderPath = getFolderPath(document.parentFolderId, folders)
    .map(sanitizePathSegment)
    .filter(Boolean)
    .join('/');
  const root = contentRoot.trim().replace(/^\/+|\/+$/g, '') || 'content';
  const fileName = `${sanitizePathSegment(document.slug) || 'untitled'}.md`;
  return folderPath ? `${root}/${folderPath}/${fileName}` : `${root}/${fileName}`;
};

const getHeaders = (token: string) => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'X-GitHub-Api-Version': '2022-11-28',
});

const encodeContentPath = (path: string) =>
  path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

type SyncResult = {
  sha: string;
  path: string;
};

const fetchRemoteSha = async (
  settings: GithubSettings,
  path: string,
): Promise<string | undefined> => {
  const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodeContentPath(
    path,
  )}?ref=${encodeURIComponent(settings.branch)}`;

  const response = await fetch(url, {
    headers: getHeaders(settings.token),
  });

  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`GitHub read failed: ${response.status}`);
  }

  const payload = (await response.json()) as { sha?: string };
  return payload.sha;
};

export const syncDocumentToGithub = async (
  document: DocumentRecord,
  folders: FolderRecord[],
  settings: GithubSettings,
): Promise<SyncResult> => {
  const path = buildRemotePath(document, folders, settings.contentRoot);
  const sha = await fetchRemoteSha(settings, path);

  const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodeContentPath(
    path,
  )}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: getHeaders(settings.token),
    body: JSON.stringify({
      message: `docs(sync): update ${document.title}`,
      content: encodeBase64(document.markdown),
      branch: settings.branch,
      sha,
      ...(settings.authorName && settings.authorEmail
        ? {
            committer: {
              name: settings.authorName,
              email: settings.authorEmail,
            },
            author: {
              name: settings.authorName,
              email: settings.authorEmail,
            },
          }
        : {}),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub write failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as {
    content?: { sha?: string; path?: string };
  };

  return {
    sha: payload.content?.sha ?? sha ?? '',
    path: payload.content?.path ?? path,
  };
};

export const isGithubConfigured = (settings: GithubSettings) =>
  Boolean(
    settings.owner.trim() &&
      settings.repo.trim() &&
      settings.branch.trim() &&
      settings.contentRoot.trim() &&
      settings.token.trim(),
  );
