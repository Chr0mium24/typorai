import { Fragment, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { languages as codeMirrorLanguages } from '@codemirror/language-data';
import { Crepe } from '@milkdown/crepe';
import type {
  DocumentRecord,
  FolderRecord,
  WorkspaceSession,
} from '../types/workspace';
import { getFolderPath } from '../lib/tree';
import { restoreDisplayMathMarkdown } from '../lib/markdown-math';
import { runPythonCode } from '../lib/pyodide-runtime';
import { extractPythonBlocks } from '../lib/python-blocks';
import { PlayIcon } from './icons';

type EditorPaneProps = {
  document: DocumentRecord | null;
  createdDocumentId: string | null;
  folders: FolderRecord[];
  mode: WorkspaceSession['editorMode'];
  onChangeTitle: (title: string) => void;
  onChangeMarkdown: (markdown: string) => void;
  onCreateDocument: () => void;
};

type MilkdownSurfaceProps = {
  markdown: string;
  active: boolean;
  onChange: (markdown: string) => void;
};

type CursorSnapshot = {
  sourceStart: number;
  sourceEnd: number;
  textStart: number;
  textEnd: number;
};

type EditorTextSegment =
  | {
      kind: 'text';
      node: Text;
      length: number;
    }
  | {
      kind: 'break';
      boundary: {
        node: Text;
        offset: number;
      };
      length: 1;
    };

type MarkdownTextMap = {
  sourceToText: number[];
  textToSource: number[];
  textLength: number;
};

type PythonResult = {
  status: 'idle' | 'running' | 'done' | 'error';
  output: string;
  error: string;
};

type PythonOverlayItem = {
  id: string;
  code: string;
  toolGroup: HTMLElement;
  outputHost: HTMLElement;
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

const pythonOutputHostSelector = '.python-inline-output-host';

const codeBlockLanguages = preferredLanguageOrder
  .map((name) => codeMirrorLanguages.find((language) => language.name === name) ?? null)
  .filter((language): language is (typeof codeMirrorLanguages)[number] => Boolean(language));
const clampRatio = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
};

const getLinePrefixLength = (line: string) => {
  let offset = 0;

  while (offset < line.length) {
    const markerMatch = line.slice(offset).match(/^>\s?/);
    if (!markerMatch) break;
    offset += markerMatch[0].length;
  }

  const headingMatch = line.slice(offset).match(/^#{1,6}\s+/);
  if (headingMatch) {
    return offset + headingMatch[0].length;
  }

  const unorderedMatch = line.slice(offset).match(/^[-+*]\s+/);
  if (unorderedMatch) {
    let length = offset + unorderedMatch[0].length;
    const taskMatch = line.slice(length).match(/^\[(?: |x|X)\]\s+/);
    if (taskMatch) {
      length += taskMatch[0].length;
    }
    return length;
  }

  const orderedMatch = line.slice(offset).match(/^\d+[.)]\s+/);
  if (orderedMatch) {
    let length = offset + orderedMatch[0].length;
    const taskMatch = line.slice(length).match(/^\[(?: |x|X)\]\s+/);
    if (taskMatch) {
      length += taskMatch[0].length;
    }
    return length;
  }

  return offset;
};

const buildMarkdownTextMap = (markdown: string): MarkdownTextMap => {
  const sourceToText = new Array<number>(markdown.length + 1).fill(0);
  const visible = new Array<boolean>(markdown.length).fill(false);
  const fencePattern = /^ {0,3}(```+|~~~+)/;
  const hrPattern = /^ {0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/;
  let index = 0;
  let inFence = false;

  while (index < markdown.length) {
    const lineStart = index;
    let lineEnd = index;
    while (lineEnd < markdown.length && markdown[lineEnd] !== '\n') {
      lineEnd += 1;
    }

    const line = markdown.slice(lineStart, lineEnd);
    const newlineIndex = lineEnd < markdown.length ? lineEnd : -1;

    if (inFence) {
      if (fencePattern.test(line)) {
        inFence = false;
      } else {
        for (let position = lineStart; position < lineEnd; position += 1) {
          visible[position] = true;
        }
        if (newlineIndex >= 0) {
          visible[newlineIndex] = true;
        }
      }
    } else if (fencePattern.test(line)) {
      inFence = true;
    } else if (!hrPattern.test(line.trim())) {
      const prefixLength = getLinePrefixLength(line);
      for (
        let position = lineStart + Math.min(prefixLength, line.length);
        position < lineEnd;
        position += 1
      ) {
        visible[position] = true;
      }
    }

    index = newlineIndex >= 0 ? newlineIndex + 1 : lineEnd + 1;
  }

  let textLength = 0;

  for (let position = 0; position < markdown.length; position += 1) {
    sourceToText[position] = textLength;
    if (visible[position]) textLength += 1;

    sourceToText[position + 1] = textLength;
  }

  const textToSource = new Array<number>(textLength + 1).fill(markdown.length);
  for (let position = 0; position <= markdown.length; position += 1) {
    textToSource[sourceToText[position]] = position;
  }

  return {
    sourceToText,
    textToSource,
    textLength,
  };
};

const getSourceCursorSnapshot = (
  selectionStart: number,
  selectionEnd: number,
  value: string,
): CursorSnapshot => {
  const map = buildMarkdownTextMap(value);
  return {
    sourceStart: selectionStart,
    sourceEnd: selectionEnd,
    textStart: map.sourceToText[Math.min(selectionStart, value.length)] ?? 0,
    textEnd: map.sourceToText[Math.min(selectionEnd, value.length)] ?? 0,
  };
};

const editorUiTextExclusionSelector = [
  'button',
  'svg',
  'style',
  'script',
  '[aria-hidden="true"]',
  '.tools',
  '.python-inline-output-host',
  '.cm-gutters',
  '.cm-panels',
  '.cm-tooltip',
  '.cm-foldPlaceholder',
].join(', ');

const isCodeMirrorTextNode = (parent: Element) => Boolean(parent.closest('.cm-content'));

const isIgnoredEditorElement = (element: Element) =>
  Boolean(element.closest(editorUiTextExclusionSelector));

const isEditorTextNode = (node: Node): node is Text => {
  if (node.nodeType !== Node.TEXT_NODE) return false;
  if (!node.textContent) return false;

  const parent = node.parentElement;
  if (!parent) return false;
  if (isIgnoredEditorElement(parent)) return false;
  if (isCodeMirrorTextNode(parent)) return true;
  if (parent.closest('[contenteditable="false"]')) return false;
  return true;
};

const getNodeTextLength = (node: Node): number => {
  if (isEditorTextNode(node)) {
    return node.textContent?.length ?? 0;
  }

  if (node instanceof Element && isIgnoredEditorElement(node)) {
    return 0;
  }

  let total = 0;
  node.childNodes.forEach((child) => {
    total += getNodeTextLength(child);
  });

  if (node instanceof Element && node.classList.contains('cm-line')) {
    total += 1;
  }

  return total;
};

const measureTextOffset = (
  root: Node,
  targetNode: Node,
  targetOffset: number,
): number => {
  let total = 0;

  const walk = (node: Node): boolean => {
    if (node === targetNode) {
      if (isEditorTextNode(node)) {
        total += Math.min(targetOffset, node.textContent?.length ?? 0);
      } else {
        const limit = Math.min(targetOffset, node.childNodes.length);
        for (let index = 0; index < limit; index += 1) {
          total += getNodeTextLength(node.childNodes[index]);
        }
      }
      return true;
    }

    if (isEditorTextNode(node)) {
      total += node.textContent?.length ?? 0;
      return false;
    }

    if (node instanceof Element && isIgnoredEditorElement(node)) {
      return false;
    }

    for (const child of node.childNodes) {
      if (walk(child)) return true;
    }

    if (node instanceof Element && node.classList.contains('cm-line')) {
      total += 1;
    }

    return false;
  };

  return walk(root) ? total : 0;
};

const collectEditorTextSegments = (editor: HTMLElement) => {
  const segments: EditorTextSegment[] = [];
  let totalLength = 0;

  const walk = (node: Node): Text | null => {
    if (isEditorTextNode(node)) {
      const length = node.textContent?.length ?? 0;
      segments.push({
        kind: 'text',
        node,
        length,
      });
      totalLength += length;
      return node;
    }

    if (node instanceof Element && isIgnoredEditorElement(node)) {
      return null;
    }

    let lastTextNode: Text | null = null;

    node.childNodes.forEach((child) => {
      const childLastTextNode = walk(child);
      if (childLastTextNode) {
        lastTextNode = childLastTextNode;
      }
    });

    if (node instanceof Element && node.classList.contains('cm-line') && lastTextNode) {
      const boundaryNode = lastTextNode as Text;

      segments.push({
        kind: 'break',
        boundary: {
          node: boundaryNode,
          offset: boundaryNode.nodeValue?.length ?? 0,
        },
        length: 1,
      });
      totalLength += 1;
    }

    return lastTextNode;
  };

  walk(editor);

  return {
    segments,
    totalLength,
  };
};

const getSelectionTextSnapshotFromEditor = (
  container: HTMLDivElement,
): Pick<CursorSnapshot, 'textStart' | 'textEnd'> | null => {
  const editor = container.querySelector<HTMLElement>('.ProseMirror');
  const selection = window.getSelection();
  if (!editor || !selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    return null;
  }

  return {
    textStart: measureTextOffset(editor, range.startContainer, range.startOffset),
    textEnd: measureTextOffset(editor, range.endContainer, range.endOffset),
  };
};

const restoreVisualSelection = (
  container: HTMLDivElement,
  selectionSnapshot: Pick<CursorSnapshot, 'textStart' | 'textEnd'>,
) => {
  const editor = container.querySelector<HTMLElement>('.ProseMirror');
  if (!editor) return;

  const { segments, totalLength } = collectEditorTextSegments(editor);

  editor.focus();

  const textSegments = segments.filter(
    (segment) => segment.kind === 'text',
  ) as Array<Extract<EditorTextSegment, { kind: 'text' }>>;

  if (textSegments.length === 0 || totalLength === 0) {
    editor.scrollTop = 0;
    return;
  }

  const resolveBoundary = (targetOffset: number) => {
    const normalizedTarget = Math.min(Math.max(targetOffset, 0), totalLength);
    let consumed = 0;
    let selectedNode = textSegments[textSegments.length - 1].node;
    let offset = selectedNode.textContent?.length ?? 0;

    for (const segment of segments) {
      if (consumed + segment.length >= normalizedTarget) {
        if (segment.kind === 'break') {
          return segment.boundary;
        }

        selectedNode = segment.node;
        offset = Math.max(normalizedTarget - consumed, 0);
        return {
          node: selectedNode,
          offset: Math.min(offset, selectedNode.length),
        };
      }
      consumed += segment.length;
    }

    return {
      node: selectedNode,
      offset,
    };
  };

  const range = document.createRange();
  const startBoundary = resolveBoundary(selectionSnapshot.textStart);
  const endBoundary = resolveBoundary(selectionSnapshot.textEnd);
  range.setStart(startBoundary.node, startBoundary.offset);
  range.setEnd(endBoundary.node, endBoundary.offset);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  const scroller = container.closest('.editor-card');
  if (scroller instanceof HTMLElement) {
    scroller.scrollTop =
      (scroller.scrollHeight - scroller.clientHeight) *
      clampRatio(selectionSnapshot.textStart / Math.max(totalLength, 1));
  }
};

const getEscapedHtml = (value: string) =>
  value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] ?? char));

const MilkdownSurface = ({ markdown, active, onChange }: MilkdownSurfaceProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const onChangeRef = useRef(onChange);
  const editorMarkdownRef = useRef(markdown);

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
      },
      featureConfigs: {
        [Crepe.Feature.CodeMirror]: {
          languages: codeBlockLanguages,
          searchPlaceholder: 'Search language',
        },
      },
    });

    crepe.on((api) => {
      api.markdownUpdated((_, nextMarkdown) => {
        const normalizedMarkdown = restoreDisplayMathMarkdown(nextMarkdown);
        editorMarkdownRef.current = normalizedMarkdown;
        onChangeRef.current(normalizedMarkdown);
      });
    });

    await crepe.create();
    editorMarkdownRef.current = defaultValue;
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
    };
  }, []);

  useEffect(() => {
    if (!active) return;

    const current = crepeRef.current;
    if (!current) return;
    if (markdown === editorMarkdownRef.current) return;

    let cancelled = false;
    crepeRef.current = null;

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

    let disposed = false;
    let root: HTMLElement | null = null;
    let observer: MutationObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const attach = () => {
      if (disposed) return;

      root = rootRef.current?.querySelector('.ProseMirror') ?? null;
      if (!(root instanceof HTMLElement)) {
        window.requestAnimationFrame(attach);
        return;
      }

      const measure = () => {
        if (disposed || !(root instanceof HTMLElement)) return;

        const blocks = extractPythonBlocks(markdown);
        const codeNodes = Array.from(
          root.querySelectorAll<HTMLElement>('pre > code, .cm-content'),
        );
        const used = new Set<number>();
        const nextItems: PythonOverlayItem[] = [];
        const nextHostIds = new Set<string>();

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

          const codeBlock = blockRoot.closest<HTMLElement>('.milkdown-code-block');
          const toolGroup =
            codeBlock?.querySelector<HTMLElement>('.tools .tools-button-group') ?? null;
          if (!(toolGroup instanceof HTMLElement) || !(codeBlock instanceof HTMLElement)) return;

          let outputHost = codeBlock.querySelector<HTMLElement>(
            `${pythonOutputHostSelector}[data-python-block-id="${block.id}"]`,
          );
          if (!(outputHost instanceof HTMLElement)) {
            outputHost = window.document.createElement('div');
            outputHost.className = 'python-inline-output-host';
            outputHost.dataset.pythonBlockId = block.id;
            codeBlock.appendChild(outputHost);
          }

          nextHostIds.add(block.id);

          nextItems.push({
            id: block.id,
            code: block.code,
            toolGroup,
            outputHost,
          });
        });

        root.querySelectorAll<HTMLElement>(pythonOutputHostSelector).forEach((host) => {
          const hostId = host.dataset.pythonBlockId;
          if (!hostId || nextHostIds.has(hostId)) return;
          host.remove();
        });

        setItems(nextItems);
      };

      observer = new MutationObserver(() => {
        window.requestAnimationFrame(measure);
      });

      observer.observe(root, {
        childList: true,
        subtree: true,
      });

      resizeObserver = new ResizeObserver(() => {
        window.requestAnimationFrame(measure);
      });

      resizeObserver.observe(root);
      window.requestAnimationFrame(measure);
    };

    attach();

    return () => {
      disposed = true;
      observer?.disconnect();
      resizeObserver?.disconnect();
      root?.querySelectorAll<HTMLElement>(pythonOutputHostSelector).forEach((host) => {
        host.remove();
      });
      setItems([]);
    };
  }, [markdown, mode, rootRef]);

  if (mode !== 'wysiwyg' || items.length === 0) return null;

  return (
    <>
      {items.map((item) => {
        const state = results[item.id] ?? emptyPythonResult;

        return (
          <Fragment key={item.id}>
            {createPortal(
              <button
                className={`copy-button python-inline-run ${state.status}`}
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
                <span className="milkdown-icon">
                  <PlayIcon width={12} height={12} />
                </span>
                <span>Run</span>
              </button>,
              item.toolGroup,
            )}

            {state.status !== 'idle' ? (
              createPortal(
                <div
                  className={`python-inline-output ${state.error ? 'has-error' : ''} ${
                    state.status === 'running' ? 'is-running' : ''
                  }`}
                >
                  <div className="python-inline-output-meta">
                    <span className="python-inline-output-label">
                      {state.error ? 'Error' : state.status === 'running' ? 'Running' : 'Output'}
                    </span>
                    <span className="python-inline-output-state">
                      {state.status === 'running'
                        ? 'Executing Python'
                        : state.error
                          ? 'Execution Failed'
                          : 'Execution Complete'}
                    </span>
                  </div>
                  {state.status === 'running' ? (
                    <pre>Running...</pre>
                  ) : null}
                  {state.output ? (
                    <pre dangerouslySetInnerHTML={{ __html: getEscapedHtml(state.output) }} />
                  ) : null}
                  {state.error ? (
                    <pre
                      className="python-inline-error"
                      dangerouslySetInnerHTML={{ __html: getEscapedHtml(state.error) }}
                    />
                  ) : null}
                </div>,
                item.outputHost,
              )
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
};

const EditorPane = ({
  document,
  createdDocumentId,
  folders,
  mode,
  onChangeTitle,
  onChangeMarkdown,
  onCreateDocument,
}: EditorPaneProps) => {
  const sourceEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const visualEditorRef = useRef<HTMLDivElement | null>(null);
  const previousDocumentIdRef = useRef<string | null>(document?.id ?? null);
  const markdownMapRef = useRef<MarkdownTextMap>(buildMarkdownTextMap(document?.markdown ?? ''));
  const sourceSelectionRef = useRef<CursorSnapshot>({
    sourceStart: 0,
    sourceEnd: 0,
    textStart: 0,
    textEnd: 0,
  });
  const [documentMotion, setDocumentMotion] = useState<{
    key: number;
    type: 'idle' | 'switch' | 'create';
  }>({
    key: 0,
    type: 'idle',
  });

  const breadcrumb = useMemo(() => {
    if (!document) return [];
    return getFolderPath(document.parentFolderId, folders);
  }, [document, folders]);

  useEffect(() => {
    markdownMapRef.current = buildMarkdownTextMap(document?.markdown ?? '');
    sourceSelectionRef.current = {
      sourceStart: 0,
      sourceEnd: 0,
      textStart: 0,
      textEnd: 0,
    };
  }, [document?.id]);

  useEffect(() => {
    const nextDocumentId = document?.id ?? null;
    const previousDocumentId = previousDocumentIdRef.current;

    if (!nextDocumentId || previousDocumentId === nextDocumentId) {
      previousDocumentIdRef.current = nextDocumentId;
      return;
    }

    setDocumentMotion((current) => ({
      key: current.key + 1,
      type: nextDocumentId === createdDocumentId ? 'create' : 'switch',
    }));
    previousDocumentIdRef.current = nextDocumentId;
  }, [createdDocumentId, document?.id]);

  useEffect(() => {
    markdownMapRef.current = buildMarkdownTextMap(document?.markdown ?? '');
  }, [document?.markdown]);

  useEffect(() => {
    if (!document) return;

    if (mode === 'source') {
      const textarea = sourceEditorRef.current;
      if (!textarea) return;
      const nextStart = Math.min(
        sourceSelectionRef.current.sourceStart,
        textarea.value.length,
      );
      const nextEnd = Math.min(sourceSelectionRef.current.sourceEnd, textarea.value.length);
      window.requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(nextStart, nextEnd);
      });
      return;
    }

    window.requestAnimationFrame(() => {
      if (!visualEditorRef.current) return;
      restoreVisualSelection(visualEditorRef.current, sourceSelectionRef.current);
    });
  }, [document?.id, mode]);

  useEffect(() => {
    if (!document) return;
    if (mode !== 'wysiwyg') return;
    const root = visualEditorRef.current;
    if (!root) return;
    const markdownLength = document.markdown.length;

    const updateFromVisual = () => {
      if (!visualEditorRef.current) return;
      const snapshot = getSelectionTextSnapshotFromEditor(visualEditorRef.current);
      if (!snapshot) return;

      const map = markdownMapRef.current;
      const textStart = Math.min(Math.max(snapshot.textStart, 0), map.textLength);
      const textEnd = Math.min(Math.max(snapshot.textEnd, 0), map.textLength);

      sourceSelectionRef.current = {
        sourceStart: map.textToSource[textStart] ?? markdownLength,
        sourceEnd: map.textToSource[textEnd] ?? markdownLength,
        textStart,
        textEnd,
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
      <div
        key={`${document.id}-${documentMotion.key}`}
        className={`editor-document-frame ${
          documentMotion.type === 'create'
            ? 'is-created'
            : documentMotion.type === 'switch'
              ? 'is-switching'
              : ''
        }`}
      >
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
                  sourceSelectionRef.current = getSourceCursorSnapshot(
                    event.currentTarget.selectionStart,
                    event.currentTarget.selectionEnd,
                    event.currentTarget.value,
                  );
                  onChangeMarkdown(event.target.value);
                }}
                onClick={(event) => {
                  sourceSelectionRef.current = getSourceCursorSnapshot(
                    event.currentTarget.selectionStart,
                    event.currentTarget.selectionEnd,
                    event.currentTarget.value,
                  );
                }}
                onKeyUp={(event) => {
                  sourceSelectionRef.current = getSourceCursorSnapshot(
                    event.currentTarget.selectionStart,
                    event.currentTarget.selectionEnd,
                    event.currentTarget.value,
                  );
                }}
                onSelect={(event) => {
                  sourceSelectionRef.current = getSourceCursorSnapshot(
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
      </div>
    </section>
  );
};

export { EditorPane };
export default EditorPane;
