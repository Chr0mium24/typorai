import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { buildDefaultWorkspace, type WorkspaceSnapshot } from '../shared/workspace.js';

const host = process.env.API_HOST ?? '127.0.0.1';
const port = Number(process.env.API_PORT ?? 3001);
const rootDir = process.cwd();
const dataDir = join(rootDir, 'data');
const workspaceFile = join(dataDir, 'workspace.json');
const distDir = join(rootDir, 'dist');

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isString = (value: unknown): value is string => typeof value === 'string';

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isFolderRecord = (value: unknown) =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.name) &&
  isNullableString(value.parentId) &&
  typeof value.expanded === 'boolean' &&
  isString(value.createdAt) &&
  isString(value.updatedAt);

const isDocumentRecord = (value: unknown) =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.title) &&
  isString(value.slug) &&
  isNullableString(value.parentFolderId) &&
  isString(value.markdown) &&
  isString(value.createdAt) &&
  isString(value.updatedAt) &&
  typeof value.dirty === 'boolean' &&
  (value.lastSavedAt === undefined || isString(value.lastSavedAt)) &&
  (value.saveError === undefined || value.saveError === null || isString(value.saveError));

const isWorkspaceSession = (value: unknown) =>
  isObject(value) &&
  Array.isArray(value.openDocumentIds) &&
  value.openDocumentIds.every(isString) &&
  isNullableString(value.activeDocumentId) &&
  isNullableString(value.selectedFolderId) &&
  typeof value.sidebarCollapsed === 'boolean' &&
  (value.editorMode === 'wysiwyg' || value.editorMode === 'source');

const isWorkspaceSnapshot = (value: unknown): value is WorkspaceSnapshot =>
  isObject(value) &&
  Array.isArray(value.documents) &&
  value.documents.every(isDocumentRecord) &&
  Array.isArray(value.folders) &&
  value.folders.every(isFolderRecord) &&
  isWorkspaceSession(value.session);

const sendJson = (
  response: import('node:http').ServerResponse,
  statusCode: number,
  body: unknown,
) => {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
};

const readRequestBody = async (
  request: import('node:http').IncomingMessage,
): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf-8');
};

const ensureWorkspaceFile = async (): Promise<WorkspaceSnapshot> => {
  try {
    const raw = await fs.readFile(workspaceFile, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isWorkspaceSnapshot(parsed)) {
      throw new Error('workspace file is invalid');
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[typorai] workspace bootstrap fallback:', error);
    }

    const defaults = buildDefaultWorkspace();
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(workspaceFile, JSON.stringify(defaults, null, 2), 'utf-8');
    return defaults;
  }
};

const persistWorkspace = async (snapshot: WorkspaceSnapshot) => {
  await fs.mkdir(dataDir, { recursive: true });
  const tempFile = `${workspaceFile}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(snapshot, null, 2), 'utf-8');
  await fs.rename(tempFile, workspaceFile);
};

const serveStaticAsset = async (
  pathname: string,
  response: import('node:http').ServerResponse,
) => {
  const relativePath =
    pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const safePath = normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const targetPath = join(distDir, safePath);

  try {
    const data = await fs.readFile(targetPath);
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(targetPath)] ?? 'application/octet-stream',
    });
    response.end(data);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      response.writeHead(500);
      response.end('Failed to read asset');
      return;
    }
  }

  try {
    const indexHtml = await fs.readFile(join(distDir, 'index.html'));
    response.writeHead(200, {
      'Content-Type': contentTypes['.html'],
      'Cache-Control': 'no-cache',
    });
    response.end(indexHtml);
  } catch {
    response.writeHead(404, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
    response.end('Frontend bundle not found. Run "pnpm build" first.');
  }
};

const server = createServer(async (request, response) => {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (url.pathname === '/api/health') {
    sendJson(response, 200, { data: { status: 'ok' } });
    return;
  }

  if (url.pathname === '/api/workspace') {
    if (method === 'GET') {
      const snapshot = await ensureWorkspaceFile();
      sendJson(response, 200, { data: snapshot });
      return;
    }

    if (method === 'PUT') {
      try {
        const rawBody = await readRequestBody(request);
        const parsed = JSON.parse(rawBody) as unknown;

        if (!isWorkspaceSnapshot(parsed)) {
          sendJson(response, 400, {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid workspace payload',
            },
          });
          return;
        }

        await persistWorkspace(parsed);
        sendJson(response, 200, {
          data: {
            savedAt: new Date().toISOString(),
          },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown persistence error';
        console.error('[typorai] workspace persistence failed:', error);
        sendJson(response, 500, {
          error: {
            code: 'PERSISTENCE_ERROR',
            message,
          },
        });
      }
      return;
    }

    sendJson(response, 405, {
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method not allowed',
      },
    });
    return;
  }

  if (method === 'GET' || method === 'HEAD') {
    await serveStaticAsset(url.pathname, response);
    return;
  }

  sendJson(response, 404, {
    error: {
      code: 'NOT_FOUND',
      message: 'Not found',
    },
  });
});

server.listen(port, host, () => {
  console.log(`[typorai] backend listening at http://${host}:${port}`);
});
