import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
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
import { runPythonCode } from '../lib/pyodide-runtime';
import { extractPythonBlocks } from '../lib/python-blocks';
import { CodeIcon, RefreshIcon, SettingsIcon } from './icons';

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

type CursorSnapshot = {
  start: number;
  end: number;
  ratio: number;
};

type PythonResult = {
  status: 'idle' | 'running' | 'done' | 'error';
  output: string;
  error: string;
};

const emptyPythonResult: PythonResult = {
  status: 'idle',
  output: '',
  error: '',
};

const clampRatio = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
};

const getCursorSnapshot = (
  selectionStart: number,
  selectionEnd: number,
  value: string,
): CursorSnapshot => {
  const length = Math.max(value.length, 1);
  return {
    start: selectionStart,
    end: selectionEnd,
    ratio: clampRatio(selectionStart / length),
  };
};

const restoreVisualSelection = (container: HTMLDivElement, ratio: number) => {
  const editor = container.querySelector<HTMLElement>('.ProseMirror');
  if (!editor) return;

  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let totalLength = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.textContent) continue;
    textNodes.push(node);
    totalLength += node.textContent.length;
  }

  editor.focus();

  if (textNodes.length === 0 || totalLength === 0) {
    editor.scrollTop = 0;
    return;
  }

  const target = Math.round(totalLength * clampRatio(ratio));
  let consumed = 0;
  let selectedNode = textNodes[textNodes.length - 1];
  let offset = selectedNode.textContent?.length ?? 0;

  for (const node of textNodes) {
    const length = node.textContent?.length ?? 0;
    if (consumed + length >= target) {
      selectedNode = node;
      offset = Math.max(target - consumed, 0);
      break;
    }
    consumed += length;
  }

  const range = document.createRange();
  range.setStart(selectedNode, Math.min(offset, selectedNode.length));
  range.collapse(true);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  const scroller = container.closest('.editor-card');
  if (scroller instanceof HTMLElement) {
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * clampRatio(ratio);
  }
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

type PythonDecorationsProps = {
  markdown: string;
  mode: WorkspaceSession['editorMode'];
  rootRef: RefObject<HTMLDivElement>;
};

const PythonDecorations = ({
  markdown,
  mode,
  rootRef,
}: PythonDecorationsProps) => {
  const [results, setResults] = useState<Record<string, PythonResult>>({});

  useEffect(() => {
    if (mode !== 'wysiwyg') return;

    const root = rootRef.current?.querySelector('.ProseMirror');
    if (!(root instanceof HTMLElement)) return;

    const blocks = extractPythonBlocks(markdown);
    let disposed = false;

    const decorate = () => {
      if (disposed) return;

      root.querySelectorAll('.python-inline-toolbar, .python-inline-output').forEach((node) => {
        node.remove();
      });

      root.querySelectorAll('pre.python-runnable').forEach((node) => {
        node.classList.remove('python-runnable');
      });

      const codeNodes = Array.from(root.querySelectorAll('pre > code'));
      const used = new Set<number>();

      blocks.forEach((block) => {
        const matchIndex = codeNodes.findIndex((node, index) => {
          if (used.has(index)) return false;
          const code = node.textContent?.replace(/\n$/, '') ?? '';
          return code === block.code;
        });

        if (matchIndex < 0) return;
        used.add(matchIndex);

        const codeNode = codeNodes[matchIndex];
        const pre = codeNode.parentElement;
        if (!(pre instanceof HTMLElement)) return;

        pre.classList.add('python-runnable');

        const toolbar = document.createElement('div');
        toolbar.className = 'python-inline-toolbar';

        const runButton = document.createElement('button');
        const state = results[block.id] ?? emptyPythonResult;
        runButton.className = `python-inline-run ${state.status}`;
        runButton.type = 'button';
        runButton.title = '运行 Python';
        runButton.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m8 6 10 6-10 6z"></path></svg><span>Run</span>';
        runButton.disabled = state.status === 'running';
        runButton.onclick = async () => {
          setResults((current) => ({
            ...current,
            [block.id]: {
              ...emptyPythonResult,
              status: 'running',
            },
          }));

          const result = await runPythonCode(block.code);

          setResults((current) => ({
            ...current,
            [block.id]: {
              status: result.error ? 'error' : 'done',
              output: result.output,
              error: result.error ?? '',
            },
          }));
        };

        toolbar.appendChild(runButton);
        pre.appendChild(toolbar);

        if (state.status !== 'idle') {
          const output = document.createElement('div');
          output.className = `python-inline-output ${state.error ? 'has-error' : ''}`;
          output.innerHTML = `
            ${state.output ? `<pre>${state.output.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] ?? char))}</pre>` : ''}
            ${state.error ? `<pre class="python-inline-error">${state.error.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] ?? char))}</pre>` : ''}
          `;
          pre.insertAdjacentElement('afterend', output);
        }
      });
    };

    const observer = new MutationObserver(() => {
      window.requestAnimationFrame(decorate);
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
    });

    window.requestAnimationFrame(decorate);

    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [markdown, mode, results, rootRef]);

  return null;
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
  const sourceSelectionRef = useRef<CursorSnapshot>({
    start: 0,
    end: 0,
    ratio: 0,
  });

  const breadcrumb = useMemo(() => {
    if (!document) return [];
    return getFolderPath(document.parentFolderId, folders);
  }, [document, folders]);

  useEffect(() => {
    sourceSelectionRef.current = { start: 0, end: 0, ratio: 0 };
  }, [document?.id]);

  useEffect(() => {
    if (!document) return;

    if (mode === 'source') {
      const textarea = sourceEditorRef.current;
      if (!textarea) return;
      const nextStart = Math.min(sourceSelectionRef.current.start, textarea.value.length);
      const nextEnd = Math.min(sourceSelectionRef.current.end, textarea.value.length);
      window.requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(nextStart, nextEnd);
      });
      return;
    }

    window.requestAnimationFrame(() => {
      if (!visualEditorRef.current) return;
      restoreVisualSelection(visualEditorRef.current, sourceSelectionRef.current.ratio);
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
            <PythonDecorations
              markdown={document.markdown}
              mode={mode}
              rootRef={visualEditorRef}
            />
          </div>
          <div
            className={`editor-mode-pane source-pane ${
              mode === 'source' ? 'is-visible' : 'is-hidden'
            }`}
          >
            <textarea
              className="source-editor"
              onChange={(event) => {
                sourceSelectionRef.current = getCursorSnapshot(
                  event.currentTarget.selectionStart,
                  event.currentTarget.selectionEnd,
                  event.currentTarget.value,
                );
                onChangeMarkdown(event.target.value);
              }}
              onClick={(event) => {
                sourceSelectionRef.current = getCursorSnapshot(
                  event.currentTarget.selectionStart,
                  event.currentTarget.selectionEnd,
                  event.currentTarget.value,
                );
              }}
              onKeyUp={(event) => {
                sourceSelectionRef.current = getCursorSnapshot(
                  event.currentTarget.selectionStart,
                  event.currentTarget.selectionEnd,
                  event.currentTarget.value,
                );
              }}
              onSelect={(event) => {
                sourceSelectionRef.current = getCursorSnapshot(
                  event.currentTarget.selectionStart,
                  event.currentTarget.selectionEnd,
                  event.currentTarget.value,
                );
              }}
              placeholder="Markdown source"
              ref={sourceEditorRef}
              spellCheck={false}
              value={document.markdown}
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export { EditorPane };
export default EditorPane;
