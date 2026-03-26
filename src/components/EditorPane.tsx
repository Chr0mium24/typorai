import { Fragment, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { languages as codeMirrorLanguages } from '@codemirror/language-data';
import { Crepe } from '@milkdown/crepe';
import type {
  AISettings,
  DocumentRecord,
  FolderRecord,
  WorkspaceSession,
} from '../types/workspace';
import { hasAIConfig, streamAIText } from '../lib/ai';
import { getFolderPath } from '../lib/tree';
import { restoreDisplayMathMarkdown } from '../lib/markdown-math';
import { runPythonCode } from '../lib/pyodide-runtime';
import { extractPythonBlocks } from '../lib/python-blocks';
import {
  CodeIcon,
  DownloadIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlayIcon,
  RefreshIcon,
  SettingsIcon,
} from './icons';

type EditorPaneProps = {
  document: DocumentRecord | null;
  folders: FolderRecord[];
  browserSaveState: 'idle' | 'saving' | 'saved';
  aiSettings: AISettings;
  lastBrowserSaveAt?: string;
  mode: WorkspaceSession['editorMode'];
  sidebarCollapsed: boolean;
  onChangeTitle: (title: string) => void;
  onChangeMarkdown: (markdown: string) => void;
  onCreateDocument: () => void;
  onExportDocument: () => void;
  exportDisabled?: boolean;
  onOpenSettings: () => void;
  onSyncNow: () => void;
  onToggleMode: () => void;
  onToggleSidebar: () => void;
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

type AIInsertSession = {
  blockStart: number;
  contentStart: number;
  contentEnd: number;
  trailingPaddingLength: number;
};

type AIUndoEntry = {
  documentId: string;
  beforeMarkdown: string;
  afterMarkdown: string;
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

const normalizeGeneratedBlockSpacing = (markdown: string) =>
  markdown.replace(/\n{4,}/g, '\n\n\n').replace(/^\n+/, '').replace(/\n+$/, '\n');

const getLeadingGap = (before: string) => {
  if (before.length === 0) return '';
  if (before.endsWith('\n\n')) return '';
  if (before.endsWith('\n')) return '\n';
  return '\n\n';
};

const getTrailingGap = (after: string) => {
  if (after.length === 0) return '';
  if (after.startsWith('\n\n')) return '';
  if (after.startsWith('\n')) return '\n';
  return '\n\n';
};

const createAIInsertSession = (
  markdown: string,
  start: number,
  end: number,
): {
  markdown: string;
  session: AIInsertSession;
} => {
  const safeEnd = Math.min(Math.max(end, start), markdown.length);
  const before = markdown.slice(0, safeEnd);
  const after = markdown.slice(safeEnd);
  const leadingGap = getLeadingGap(before);
  const trailingGap = getTrailingGap(after);
  const contentStart = before.length + leadingGap.length;

  return {
    markdown: `${before}${leadingGap}${trailingGap}${after}`,
    session: {
      blockStart: before.length,
      contentStart,
      contentEnd: contentStart,
      trailingPaddingLength: trailingGap.length,
    },
  };
};

const updateAIInsertSession = (
  markdown: string,
  session: AIInsertSession,
  nextContent: string,
): {
  markdown: string;
  session: AIInsertSession;
} => {
  const contentEnd = session.contentStart + nextContent.length;

  return {
    markdown: `${markdown.slice(0, session.contentStart)}${nextContent}${markdown.slice(
      session.contentEnd,
    )}`,
    session: {
      ...session,
      contentEnd,
    },
  };
};

const removeAIInsertSession = (markdown: string, session: AIInsertSession) =>
  normalizeGeneratedBlockSpacing(
    `${markdown.slice(0, session.blockStart)}${markdown.slice(
      session.contentEnd + session.trailingPaddingLength,
    )}`,
  );

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
  const commentPattern = /^ {0,3}<!--[\s\S]*?-->$/;
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
    } else if (!hrPattern.test(line.trim()) && !commentPattern.test(line.trim())) {
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

const formatPastTime = (timestamp?: string) => {
  if (!timestamp) return '尚未保存';
  const distanceMs = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.max(Math.round(distanceMs / 60000), 0);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  return `${hours} 小时前`;
};

const getSelectionExcerpt = (markdown: string) =>
  markdown.replace(/\s+/g, ' ').trim().slice(0, 120);

const getVisualSelectionRect = (container: HTMLDivElement) => {
  const editor = container.querySelector<HTMLElement>('.ProseMirror');
  const selection = window.getSelection();
  if (!editor || !selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (range.collapsed) return null;
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    return null;
  }

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return rect;
};

const getTextareaSelectionRect = (
  textarea: HTMLTextAreaElement,
  selectionStart: number,
  selectionEnd: number,
) => {
  if (selectionStart === selectionEnd) return null;

  const styles = window.getComputedStyle(textarea);
  const mirror = window.document.createElement('div');
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.style.overflow = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '0';
  mirror.style.font = styles.font;
  mirror.style.letterSpacing = styles.letterSpacing;
  mirror.style.lineHeight = styles.lineHeight;
  mirror.style.padding = styles.padding;
  mirror.style.border = styles.border;
  mirror.style.width = `${textarea.clientWidth}px`;

  mirror.textContent = textarea.value.slice(0, selectionEnd);
  const marker = window.document.createElement('span');
  marker.textContent = '\u200b';
  mirror.appendChild(marker);
  window.document.body.appendChild(mirror);

  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  mirror.remove();

  const textareaRect = textarea.getBoundingClientRect();
  const lineHeight = Number.parseFloat(styles.lineHeight) || 20;

  return new DOMRect(
    textareaRect.left + markerRect.left - mirrorRect.left - textarea.scrollLeft,
    textareaRect.top + markerRect.top - mirrorRect.top - textarea.scrollTop,
    1,
    lineHeight,
  );
};

const getCodeNodeContent = (node: HTMLElement) => {
  if (node.classList.contains('cm-content')) {
    return Array.from(node.querySelectorAll<HTMLElement>('.cm-line'))
      .map((line) => line.textContent ?? '')
      .join('\n')
      .replace(/\n$/, '');
  }

  return (node.textContent ?? '').replace(/\n$/, '');
};

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
            const code = getCodeNodeContent(node);
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
  folders,
  browserSaveState,
  aiSettings,
  lastBrowserSaveAt,
  mode,
  sidebarCollapsed,
  onChangeTitle,
  onChangeMarkdown,
  onCreateDocument,
  onExportDocument,
  exportDisabled = false,
  onOpenSettings,
  onSyncNow,
  onToggleMode,
  onToggleSidebar,
}: EditorPaneProps) => {
  const editorCardRef = useRef<HTMLDivElement | null>(null);
  const sourceEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const visualEditorRef = useRef<HTMLDivElement | null>(null);
  const previousDocumentIdRef = useRef<string | null>(document?.id ?? null);
  const markdownMapRef = useRef<MarkdownTextMap>(buildMarkdownTextMap(document?.markdown ?? ''));
  const markdownRef = useRef(document?.markdown ?? '');
  const aiControllersRef = useRef(new Map<string, AbortController>());
  const aiFlushTimersRef = useRef(new Map<string, number>());
  const aiGenerationInFlightRef = useRef(false);
  const aiPendingUndoRef = useRef<{
    documentId: string;
    beforeMarkdown: string;
  } | null>(null);
  const aiUndoEntryRef = useRef<AIUndoEntry | null>(null);
  const sourceSelectionRef = useRef<CursorSnapshot>({
    sourceStart: 0,
    sourceEnd: 0,
    textStart: 0,
    textEnd: 0,
  });
  const [documentMotion, setDocumentMotion] = useState<{
    key: number;
    type: 'idle' | 'switch';
  }>({
    key: 0,
    type: 'idle',
  });
  const [selectionState, setSelectionState] = useState({
    hasSelection: false,
    excerpt: '',
    top: 0,
    left: 0,
  });

  const breadcrumb = useMemo(() => {
    if (!document) return [];
    return getFolderPath(document.parentFolderId, folders);
  }, [document, folders]);
  const aiReady = hasAIConfig(aiSettings);
  const saveLabel =
    browserSaveState === 'saving'
      ? '保存中'
      : browserSaveState === 'saved'
        ? lastBrowserSaveAt
          ? `已保存 ${formatPastTime(lastBrowserSaveAt)}`
          : '已保存'
        : '等待编辑';

  const applyMarkdown = (nextMarkdown: string, source: 'user' | 'ai' = 'user') => {
    const undoEntry = aiUndoEntryRef.current;
    if (
      source === 'user' &&
      undoEntry &&
      undoEntry.documentId === document?.id &&
      nextMarkdown !== undoEntry.afterMarkdown
    ) {
      aiUndoEntryRef.current = null;
    }
    markdownRef.current = nextMarkdown;
    onChangeMarkdown(nextMarkdown);
  };

  const syncSelectionState = (
    snapshot: CursorSnapshot,
    value: string,
    rect?: DOMRect | null,
  ) => {
    sourceSelectionRef.current = snapshot;
    const start = Math.min(snapshot.sourceStart, snapshot.sourceEnd);
    const end = Math.max(snapshot.sourceStart, snapshot.sourceEnd);
    const selectedMarkdown = value.slice(start, end);
    const card = editorCardRef.current;
    const cardRect = card?.getBoundingClientRect();
    const hasSelection = start !== end && selectedMarkdown.trim().length > 0;
    const top =
      rect && card && cardRect
        ? rect.top - cardRect.top + card.scrollTop - 40
        : 0;
    const left =
      rect && card && cardRect
        ? rect.left - cardRect.left + card.scrollLeft
        : 0;

    setSelectionState({
      hasSelection,
      excerpt: getSelectionExcerpt(selectedMarkdown),
      top,
      left,
    });
  };

  const clearAIResources = (id: string) => {
    const controller = aiControllersRef.current.get(id);
    if (controller) {
      controller.abort();
      aiControllersRef.current.delete(id);
    }

    const timer = aiFlushTimersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      aiFlushTimersRef.current.delete(id);
    }
  };

  const runAIStream = async (
    session: AIInsertSession,
    selectedMarkdown: string,
    fullDocumentMarkdown?: string,
  ) => {
    if (!document) return;

    const sessionId = `${document.id}:${session.contentStart}`;
    clearAIResources(sessionId);

    const controller = new AbortController();
    aiControllersRef.current.set(sessionId, controller);

    let nextContent = '';
    let activeSession = session;

    const flushContent = () => {
      aiFlushTimersRef.current.delete(sessionId);
      const { markdown: updatedMarkdown, session: updatedSession } = updateAIInsertSession(
        markdownRef.current,
        activeSession,
        nextContent,
      );
      activeSession = updatedSession;

      if (updatedMarkdown !== markdownRef.current) {
        applyMarkdown(updatedMarkdown, 'ai');
      }
    };

    const scheduleFlush = () => {
      if (aiFlushTimersRef.current.has(sessionId)) return;
      aiFlushTimersRef.current.set(
        sessionId,
        window.setTimeout(flushContent, 160),
      );
    };

    try {
      await streamAIText(
        aiSettings,
        {
          documentTitle: document.title,
          fullDocumentMarkdown: fullDocumentMarkdown ?? markdownRef.current,
          selectedMarkdown,
          userInstruction: '',
        },
        (delta) => {
          nextContent += delta;
          scheduleFlush();
        },
        controller.signal,
      );

      flushContent();
      if (!nextContent.trim()) {
        aiPendingUndoRef.current = null;
        applyMarkdown(removeAIInsertSession(markdownRef.current, activeSession), 'ai');
      } else if (aiPendingUndoRef.current?.documentId === document.id) {
        aiUndoEntryRef.current = {
          documentId: document.id,
          beforeMarkdown: aiPendingUndoRef.current.beforeMarkdown,
          afterMarkdown: markdownRef.current,
        };
        aiPendingUndoRef.current = null;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        aiPendingUndoRef.current = null;
        return;
      }

      const message = error instanceof Error ? error.message : 'AI 生成失败';
      aiPendingUndoRef.current = null;
      applyMarkdown(removeAIInsertSession(markdownRef.current, activeSession), 'ai');
      window.alert(`AI 生成失败：${message}`);
    } finally {
      clearAIResources(sessionId);
    }
  };

  const handleAskAI = async () => {
    if (!document) return;
    if (aiGenerationInFlightRef.current) return;
    if (!aiReady) {
      window.alert('请先在设置中填写 AI provider、model 和 API key。');
      return;
    }

    const snapshot = sourceSelectionRef.current;
    const start = Math.min(snapshot.sourceStart, snapshot.sourceEnd);
    const end = Math.max(snapshot.sourceStart, snapshot.sourceEnd);
    const currentMarkdown = markdownRef.current;
    const selectedMarkdown = currentMarkdown.slice(start, end);

    if (!selectedMarkdown.trim()) return;

    const insertion = createAIInsertSession(markdownRef.current, start, end);
    aiPendingUndoRef.current = {
      documentId: document.id,
      beforeMarkdown: currentMarkdown,
    };
    aiUndoEntryRef.current = null;

    setSelectionState({
      hasSelection: false,
      excerpt: '',
      top: 0,
      left: 0,
    });
    applyMarkdown(insertion.markdown, 'ai');
    aiGenerationInFlightRef.current = true;
    try {
      await runAIStream(insertion.session, selectedMarkdown, currentMarkdown);
    } finally {
      aiGenerationInFlightRef.current = false;
    }
  };

  useEffect(() => {
    markdownMapRef.current = buildMarkdownTextMap(document?.markdown ?? '');
    markdownRef.current = document?.markdown ?? '';
    aiPendingUndoRef.current = null;
    aiUndoEntryRef.current = null;
    syncSelectionState(
      {
        sourceStart: 0,
        sourceEnd: 0,
        textStart: 0,
        textEnd: 0,
      },
      document?.markdown ?? '',
      null,
    );
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
      type: 'switch',
    }));
    previousDocumentIdRef.current = nextDocumentId;
  }, [document?.id]);

  useEffect(() => {
    markdownMapRef.current = buildMarkdownTextMap(document?.markdown ?? '');
    markdownRef.current = document?.markdown ?? '';
  }, [document?.markdown]);

  useEffect(() => {
    aiControllersRef.current.forEach((controller) => controller.abort());
    aiControllersRef.current.clear();
    aiFlushTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    aiFlushTimersRef.current.clear();
    aiGenerationInFlightRef.current = false;
    aiPendingUndoRef.current = null;
    aiUndoEntryRef.current = null;
  }, [document?.id]);

  useEffect(
    () => () => {
      aiControllersRef.current.forEach((controller) => controller.abort());
      aiControllersRef.current.clear();
      aiFlushTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      aiFlushTimersRef.current.clear();
      aiGenerationInFlightRef.current = false;
      aiPendingUndoRef.current = null;
      aiUndoEntryRef.current = null;
    },
    [],
  );

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

      syncSelectionState(
        {
          sourceStart: map.textToSource[textStart] ?? markdownLength,
          sourceEnd: map.textToSource[textEnd] ?? markdownLength,
          textStart,
          textEnd,
        },
        markdownRef.current,
        getVisualSelectionRect(visualEditorRef.current),
      );
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();

      if (key === 'z' && !event.shiftKey) {
        const undoEntry = aiUndoEntryRef.current;
        if (!document || !undoEntry || undoEntry.documentId !== document.id) return;

        event.preventDefault();
        aiControllersRef.current.forEach((controller) => controller.abort());
        aiControllersRef.current.clear();
        aiFlushTimersRef.current.forEach((timer) => window.clearTimeout(timer));
        aiFlushTimersRef.current.clear();
        aiGenerationInFlightRef.current = false;
        aiPendingUndoRef.current = null;
        aiUndoEntryRef.current = null;
        applyMarkdown(undoEntry.beforeMarkdown, 'ai');
        return;
      }

      if (key !== 'enter') return;
      if (!selectionState.hasSelection) return;

      event.preventDefault();
      void handleAskAI();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectionState.hasSelection, document?.id, aiSettings, mode]);

  const captureSourceSelection = (
    selectionStart: number,
    selectionEnd: number,
    value: string,
  ) => {
    syncSelectionState(
      getSourceCursorSnapshot(selectionStart, selectionEnd, value),
      value,
      sourceEditorRef.current
        ? getTextareaSelectionRect(sourceEditorRef.current, selectionStart, selectionEnd)
        : null,
    );
  };

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
        className={`editor-document-frame ${
          documentMotion.type === 'switch' ? 'is-switching' : ''
        }`}
        onAnimationEnd={() => {
          setDocumentMotion((current) =>
            current.type === 'idle' ? current : { ...current, type: 'idle' },
          );
        }}
        style={
          documentMotion.type === 'idle'
            ? undefined
            : {
                animationName:
                  documentMotion.key % 2 === 0
                    ? 'editor-document-switch'
                    : 'editor-document-switch-alt',
              }
        }
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
          <div className="editor-header-actions">
            <span className={`tab-save-indicator is-${browserSaveState}`}>{saveLabel}</span>
            <button
              className="icon-button"
              disabled={exportDisabled}
              onClick={onExportDocument}
              title={exportDisabled ? '没有可导出的文档' : '导出 Markdown'}
              type="button"
            >
              <DownloadIcon width={16} height={16} />
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
              className={`icon-button ${mode === 'source' ? 'is-active' : ''}`}
              onClick={onToggleMode}
              title={mode === 'source' ? '切回可视编辑' : '切换到源码模式'}
              type="button"
            >
              <CodeIcon width={16} height={16} />
            </button>
            <button
              className="icon-button"
              onClick={onToggleSidebar}
              title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
              type="button"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpenIcon width={16} height={16} />
              ) : (
                <PanelLeftCloseIcon width={16} height={16} />
              )}
            </button>
            <button
              className="icon-button"
              onClick={onOpenSettings}
              title="工作区设置"
              type="button"
            >
              <SettingsIcon width={16} height={16} />
            </button>
          </div>
        </div>

        <div
          className={`editor-card ${mode === 'source' ? 'is-source-mode' : ''}`}
          ref={editorCardRef}
        >
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
                onChange={(nextMarkdown) => applyMarkdown(nextMarkdown, 'user')}
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
                  captureSourceSelection(
                    event.currentTarget.selectionStart,
                    event.currentTarget.selectionEnd,
                    event.currentTarget.value,
                  );
                  applyMarkdown(event.target.value, 'user');
                }}
                onClick={(event) => {
                  captureSourceSelection(
                    event.currentTarget.selectionStart,
                    event.currentTarget.selectionEnd,
                    event.currentTarget.value,
                  );
                }}
                onKeyUp={(event) => {
                  captureSourceSelection(
                    event.currentTarget.selectionStart,
                    event.currentTarget.selectionEnd,
                    event.currentTarget.value,
                  );
                }}
                onSelect={(event) => {
                  captureSourceSelection(
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

          {selectionState.hasSelection ? (
            <button
              className="ai-selection-trigger"
              disabled={!aiReady}
              onClick={() => void handleAskAI()}
              style={{
                top: `${Math.max(selectionState.top, 8)}px`,
                left: `${Math.max(selectionState.left, 8)}px`,
              }}
              title={
                aiReady
                  ? '基于当前选区生成，快捷键 Cmd/Ctrl+Enter'
                  : '先去设置里填写 AI provider / model / key'
              }
              type="button"
            >
              <span>问 AI</span>
              <kbd>⌘↵</kbd>
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
};

export { EditorPane };
export default EditorPane;
