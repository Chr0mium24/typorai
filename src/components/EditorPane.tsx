import { Fragment, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { languages as codeMirrorLanguages } from '@codemirror/language-data';
import { Crepe } from '@milkdown/crepe';
import { codeMirror } from '@milkdown/crepe/feature/code-mirror';
import type {
  DocumentRecord,
  FolderRecord,
  WorkspaceSession,
} from '../types/workspace';
import { getFolderPath } from '../lib/tree';
import { runPythonCode } from '../lib/pyodide-runtime';
import { extractPythonBlocks } from '../lib/python-blocks';
import { CodeIcon, PlayIcon, RefreshIcon, SettingsIcon } from './icons';

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
  active: boolean;
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

type PythonOverlayItem = {
  id: string;
  code: string;
  buttonHost: HTMLElement | null;
  top: number;
  left: number;
  right: number;
  outputTop: number;
  width: number;
};

const emptyPythonResult: PythonResult = {
  status: 'idle',
  output: '',
  error: '',
};

const preferredLanguageOrder = [
  'Shell',
  'PowerShell',
  'JavaScript',
  'Python',
  'TypeScript',
  'C++',
] as const;

const codeBlockLanguages = preferredLanguageOrder
  .map((name) => codeMirrorLanguages.find((language) => language.name === name) ?? null)
  .filter((language): language is (typeof codeMirrorLanguages)[number] => Boolean(language));

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

const getSelectionRatioFromEditor = (container: HTMLDivElement) => {
  const editor = container.querySelector<HTMLElement>('.ProseMirror');
  const selection = window.getSelection();
  if (!editor || !selection || selection.rangeCount === 0) return 0;

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return 0;

  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let totalLength = 0;
  let beforeLength = 0;
  let reachedStart = false;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const textLength = node.textContent?.length ?? 0;

    if (!reachedStart) {
      if (node === range.startContainer) {
        beforeLength += Math.min(range.startOffset, textLength);
        reachedStart = true;
      } else {
        beforeLength += textLength;
      }
    }

    totalLength += textLength;
  }

  if (totalLength === 0) return 0;
  return clampRatio(beforeLength / totalLength);
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

const getEscapedHtml = (value: string) =>
  value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] ?? char));

const MilkdownSurface = ({ markdown, active, onChange }: MilkdownSurfaceProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const onChangeRef = useRef(onChange);

  onChangeRef.current = onChange;

  const createCrepe = async (defaultValue: string) => {
    const root = rootRef.current;
    if (!root) return null;

    root.innerHTML = '';

    const crepe = new Crepe({
      root,
      defaultValue,
      features: {
        [Crepe.Feature.Toolbar]: false,
        [Crepe.Feature.BlockEdit]: false,
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.CodeMirror]: false,
      },
    });

    crepe.addFeature(codeMirror, {
      languages: codeBlockLanguages,
      searchPlaceholder: 'Search language',
    });

    crepe.on((api) => {
      api.markdownUpdated((_, nextMarkdown) => {
        onChangeRef.current(nextMarkdown);
      });
    });

    await crepe.create();
    crepeRef.current = crepe;
    return crepe;
  };

  useEffect(() => {
    let disposed = false;

    void createCrepe(markdown).then(async (crepe) => {
      if (!disposed || !crepe) return;
      await crepe.destroy();
    });

    return () => {
      disposed = true;
      const crepe = crepeRef.current;
      crepeRef.current = null;
      if (crepe) {
        void crepe.destroy();
      }
      if (rootRef.current) {
        rootRef.current.innerHTML = '';
      }
    };
  }, []);

  useEffect(() => {
    if (!active) return;

    const current = crepeRef.current;
    if (!current || current.getMarkdown() === markdown) return;

    let cancelled = false;

    void current.destroy().then(async () => {
      if (cancelled || !rootRef.current) return;
      const next = await createCrepe(markdown);
      if (cancelled && next) {
        await next.destroy();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [active, markdown]);

  return <div className="editor-surface" ref={rootRef} />;
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
  const [items, setItems] = useState<PythonOverlayItem[]>([]);

  useEffect(() => {
    if (mode !== 'wysiwyg') return;

    const blocks = extractPythonBlocks(markdown);
    const root = rootRef.current?.querySelector('.ProseMirror');
    const card = rootRef.current?.closest('.editor-card');
    if (!(root instanceof HTMLElement) || !(card instanceof HTMLElement)) return;
    let disposed = false;

    const measure = () => {
      if (disposed) return;

      const codeNodes = Array.from(
        root.querySelectorAll<HTMLElement>('pre > code, .cm-content'),
      );
      const used = new Set<number>();
      const cardRect = card.getBoundingClientRect();
      const nextItems: PythonOverlayItem[] = [];

      blocks.forEach((block) => {
        const matchIndex = codeNodes.findIndex((node, index) => {
          if (used.has(index)) return false;
          const code = node.textContent?.replace(/\n$/, '') ?? '';
          return code === block.code;
        });

        if (matchIndex < 0) return;
        used.add(matchIndex);

        const codeNode = codeNodes[matchIndex];
        const blockRoot =
          codeNode.closest<HTMLElement>('.cm-editor') ??
          codeNode.closest<HTMLElement>('pre');
        if (!(blockRoot instanceof HTMLElement)) return;

        const blockRect = blockRoot.getBoundingClientRect();
        const codeBlock = blockRoot.closest<HTMLElement>('.milkdown-code-block');
        const buttonHost =
          codeBlock?.querySelector<HTMLElement>('.tools .tools-button-group') ?? null;
        const top = blockRoot.offsetTop;
        const left = blockRoot.offsetLeft;
        const right = Math.max(cardRect.right - blockRect.right, 0) + 8;
        const width = Math.min(
          blockRoot.clientWidth,
          Math.max(card.clientWidth - 32, 240),
        );

        nextItems.push({
          id: block.id,
          code: block.code,
          buttonHost,
          top,
          left,
          right,
          outputTop: top + blockRoot.offsetHeight + 8,
          width,
        });
      });

      setItems(nextItems);
    };

    const observer = new MutationObserver(() => {
      window.requestAnimationFrame(measure);
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
    });

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(measure);
    });

    resizeObserver.observe(card);
    window.requestAnimationFrame(measure);

    return () => {
      disposed = true;
      observer.disconnect();
      resizeObserver.disconnect();
      setItems([]);
    };
  }, [markdown, mode, rootRef]);

  if (mode !== 'wysiwyg' || items.length === 0) return null;

  return (
    <div className="python-overlay-layer">
      {items.map((item) => {
        const state = results[item.id] ?? emptyPythonResult;

        return (
          <Fragment key={item.id}>
            {item.buttonHost
              ? createPortal(
                  <button
                    className={`python-inline-run ${state.status}`}
                    disabled={state.status === 'running'}
                    onClick={async () => {
                      setResults((current) => ({
                        ...current,
                        [item.id]: {
                          ...emptyPythonResult,
                          status: 'running',
                        },
                      }));

                      const result = await runPythonCode(item.code);

                      setResults((current) => ({
                        ...current,
                        [item.id]: {
                          status: result.error ? 'error' : 'done',
                          output: result.output,
                          error: result.error ?? '',
                        },
                      }));
                    }}
                    title="运行 Python"
                    type="button"
                  >
                    <PlayIcon width={12} height={12} />
                    <span>Run</span>
                  </button>,
                  item.buttonHost,
                )
              : null}

            {state.status !== 'idle' ? (
              <div
                className={`python-inline-output ${state.error ? 'has-error' : ''}`}
                style={{
                  top: `${item.outputTop}px`,
                  left: `${item.left}px`,
                  width: `${item.width}px`,
                }}
              >
                {state.output ? (
                  <pre dangerouslySetInnerHTML={{ __html: getEscapedHtml(state.output) }} />
                ) : null}
                {state.error ? (
                  <pre
                    className="python-inline-error"
                    dangerouslySetInnerHTML={{ __html: getEscapedHtml(state.error) }}
                  />
                ) : null}
              </div>
            ) : null}
          </Fragment>
        );
      })}
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
      const target = Math.round(
        clampRatio(sourceSelectionRef.current.ratio) * textarea.value.length,
      );
      const nextStart = Math.min(target, textarea.value.length);
      const nextEnd = Math.min(target, textarea.value.length);
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

  useEffect(() => {
    if (mode !== 'wysiwyg') return;
    const root = visualEditorRef.current;
    if (!root) return;

    const updateFromVisual = () => {
      if (!visualEditorRef.current) return;
      sourceSelectionRef.current = {
        ...sourceSelectionRef.current,
        ratio: getSelectionRatioFromEditor(visualEditorRef.current),
      };
    };

    window.document.addEventListener('selectionchange', updateFromVisual);
    root.addEventListener('keyup', updateFromVisual);
    root.addEventListener('mouseup', updateFromVisual);

    return () => {
      window.document.removeEventListener('selectionchange', updateFromVisual);
      root.removeEventListener('keyup', updateFromVisual);
      root.removeEventListener('mouseup', updateFromVisual);
    };
  }, [document?.id, mode]);

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
            <MilkdownSurface
              active={mode === 'wysiwyg'}
              key={document.id}
              markdown={document.markdown}
              onChange={onChangeMarkdown}
            />
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
