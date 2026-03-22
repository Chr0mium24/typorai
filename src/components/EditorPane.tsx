import { useMemo } from 'react';
import { Editor, defaultValueCtx, rootCtx } from '@milkdown/core';
import { history } from '@milkdown/plugin-history';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { nord } from '@milkdown/theme-nord';
import type {
  DocumentRecord,
  FolderRecord,
  WorkspaceSession,
} from '../types/workspace';
import { getFolderPath } from '../lib/tree';
import { CodeIcon } from './icons';

type EditorPaneProps = {
  document: DocumentRecord | null;
  folders: FolderRecord[];
  mode: WorkspaceSession['editorMode'];
  onChangeTitle: (title: string) => void;
  onChangeMarkdown: (markdown: string) => void;
  onCreateDocument: () => void;
  onToggleMode: () => void;
};

type MilkdownSurfaceProps = {
  markdown: string;
  onChange: (markdown: string) => void;
};

const MilkdownSurface = ({ markdown, onChange }: MilkdownSurfaceProps) => {
  useEditor((root) =>
    Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, markdown);
        ctx.get(listenerCtx).markdownUpdated((_, nextMarkdown) => {
          onChange(nextMarkdown);
        });
      })
      .config(nord)
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener),
  );

  return (
    <div className="editor-surface">
      <Milkdown />
    </div>
  );
};

const EditorPane = ({
  document,
  folders,
  mode,
  onChangeTitle,
  onChangeMarkdown,
  onCreateDocument,
  onToggleMode,
}: EditorPaneProps) => {
  const breadcrumb = useMemo(() => {
    if (!document) return [];
    return getFolderPath(document.parentFolderId, folders);
  }, [document, folders]);

  if (!document) {
    return (
      <section className="editor-empty">
        <p className="eyebrow">Empty Workspace</p>
        <h2>先打开一个文档，或者新建一篇。</h2>
        <button className="primary-button" onClick={onCreateDocument} type="button">
          新建第一篇文档
        </button>
      </section>
    );
  }

  return (
    <section className="editor-pane">
      <div className="editor-header">
        <div className="editor-meta">
          <p className="editor-path">
            {breadcrumb.length > 0 ? breadcrumb.join(' / ') : 'Workspace Root'}
          </p>
          <input
            className="editor-title"
            value={document.title}
            onChange={(event) => onChangeTitle(event.target.value)}
            placeholder="文档标题"
          />
        </div>
        <div className="editor-badges">
          <button
            className={`icon-button editor-mode-toggle ${
              mode === 'source' ? 'is-active' : ''
            }`}
            onClick={onToggleMode}
            title={mode === 'source' ? '切回可视编辑' : '切换到源码模式'}
            type="button"
          >
            <CodeIcon width={16} height={16} />
          </button>
          <span className={`badge ${document.remoteDirty ? 'is-warning' : 'is-clean'}`}>
            {document.remoteDirty ? '待同步' : '已同步'}
          </span>
        </div>
      </div>

      <div className="editor-card">
        {mode === 'source' ? (
          <textarea
            className="source-editor"
            onChange={(event) => onChangeMarkdown(event.target.value)}
            placeholder="Markdown source"
            spellCheck={false}
            value={document.markdown}
          />
        ) : (
          <MilkdownProvider key={document.id}>
            <MilkdownSurface
              markdown={document.markdown}
              onChange={onChangeMarkdown}
            />
          </MilkdownProvider>
        )}
      </div>
    </section>
  );
};

export { EditorPane };
export default EditorPane;
