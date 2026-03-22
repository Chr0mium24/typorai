import { useEffect, useMemo, useRef } from 'react';
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
import { CodeIcon, RefreshIcon, SettingsIcon } from './icons';
import { PythonRunner } from './PythonRunner';

type EditorPaneProps = {
  document: DocumentRecord | null;
  folders: FolderRecord[];
  mode: WorkspaceSession['editorMode'];
  onChangeTitle: (title: string) => void;
  onChangeMarkdown: (markdown: string) => void;
  onCreateDocument: () => void;
  onOpenSettings: () => void;
  onSyncNow: () => void;
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
  onOpenSettings,
  onSyncNow,
  onToggleMode,
}: EditorPaneProps) => {
  const sourceEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const visualEditorRef = useRef<HTMLDivElement | null>(null);
  const sourceSelectionRef = useRef({ start: 0, end: 0 });

  const breadcrumb = useMemo(() => {
    if (!document) return [];
    return getFolderPath(document.parentFolderId, folders);
  }, [document, folders]);

  useEffect(() => {
    sourceSelectionRef.current = { start: 0, end: 0 };
  }, [document?.id]);

  useEffect(() => {
    if (!document) return;

    if (mode === 'source') {
      const textarea = sourceEditorRef.current;
      if (!textarea) return;
      const nextStart = Math.min(
        sourceSelectionRef.current.start,
        textarea.value.length,
      );
      const nextEnd = Math.min(sourceSelectionRef.current.end, textarea.value.length);
      window.requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(nextStart, nextEnd);
      });
      return;
    }

    window.requestAnimationFrame(() => {
      visualEditorRef.current
        ?.querySelector<HTMLElement>('.ProseMirror')
        ?.focus();
    });
  }, [document, mode]);

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
            className="icon-button"
            onClick={onOpenSettings}
            title="GitHub 设置"
            type="button"
          >
            <SettingsIcon width={16} height={16} />
          </button>
          <button
            className="icon-button"
            onClick={onSyncNow}
            title="立即同步"
            type="button"
          >
            <RefreshIcon width={16} height={16} />
          </button>
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
        <div className={`editor-stack ${mode === 'source' ? 'is-source' : 'is-wysiwyg'}`}>
          <div
            className={`editor-mode-pane visual-pane ${
              mode === 'wysiwyg' ? 'is-visible' : 'is-hidden'
            }`}
            ref={visualEditorRef}
          >
            <MilkdownProvider key={document.id}>
              <MilkdownSurface
                markdown={document.markdown}
                onChange={onChangeMarkdown}
              />
            </MilkdownProvider>
          </div>
          <div
            className={`editor-mode-pane source-pane ${
              mode === 'source' ? 'is-visible' : 'is-hidden'
            }`}
          >
            <textarea
              className="source-editor"
              onChange={(event) => onChangeMarkdown(event.target.value)}
              onSelect={(event) => {
                sourceSelectionRef.current = {
                  start: event.currentTarget.selectionStart,
                  end: event.currentTarget.selectionEnd,
                };
              }}
              placeholder="Markdown source"
              ref={sourceEditorRef}
              spellCheck={false}
              value={document.markdown}
            />
          </div>
        </div>
      </div>

      <PythonRunner markdown={document.markdown} />
    </section>
  );
};

export { EditorPane };
export default EditorPane;
