import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AISettings,
  DocumentRecord,
  FolderRecord,
  WorkspaceSession,
} from '../types/workspace';
import { hasAIConfig, streamAIText } from '../lib/ai';
import { getFolderPath } from '../lib/tree';
import {
  CodeIcon,
  DownloadIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  RefreshIcon,
  SettingsIcon,
} from './icons';
import {
  createAIInsertSession,
  removeAIInsertSession,
  updateAIInsertSession,
  type AIInsertSession,
  type AIUndoEntry,
} from './editor/ai-insert';
import { MilkdownSurface } from './editor/MilkdownSurface';
import { PythonDecorations } from './editor/PythonDecorations';
import {
  buildMarkdownTextMap,
  getSelectionTextSnapshotFromEditor,
  getSourceCursorSnapshot,
  getTextareaSelectionClientRects,
  getTextareaSelectionRect,
  getVisualSelectionClientRects,
  getVisualSelectionRect,
  restoreVisualSelection,
  type CursorSnapshot,
  type MarkdownTextMap,
} from './editor/selection-mapping';

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
  onSaveNow: () => void;
  onToggleMode: () => void;
  onToggleSidebar: () => void;
};

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
  onSaveNow,
  onToggleMode,
  onToggleSidebar,
}: EditorPaneProps) => {
  const editorCardRef = useRef<HTMLDivElement | null>(null);
  const sourceEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const visualEditorRef = useRef<HTMLDivElement | null>(null);
  const aiTriggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const aiPromptInputRef = useRef<HTMLInputElement | null>(null);
  const aiPromptMeasureRef = useRef<HTMLSpanElement | null>(null);
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
  const committedSelectionRef = useRef<CursorSnapshot | null>(null);
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
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiPromptActive, setIsAiPromptActive] = useState(false);
  const [aiPromptWidth, setAiPromptWidth] = useState(160);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [promptSelectionRects, setPromptSelectionRects] = useState<
    Array<{
      top: number;
      left: number;
      width: number;
      height: number;
    }>
  >([]);

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
  const isAiPromptShellVisible = isAiPromptActive || aiPrompt.trim().length > 0;
  const isMobilePromptSheetVisible =
    isMobileViewport && selectionState.hasSelection && isAiPromptShellVisible;

  const closeAiPrompt = () => {
    setIsAiPromptActive(false);
    if (isMobileViewport) return;
    window.requestAnimationFrame(() => {
      aiTriggerButtonRef.current?.focus();
    });
  };

  const openAiPrompt = () => {
    setIsAiPromptActive(true);
  };

  const handleAiTriggerClick = () => {
    if (isMobileViewport) {
      openAiPrompt();
      return;
    }
    void handleAskAI();
  };

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

  const mapOverlayRects = (rects: DOMRect[]) => {
    const card = editorCardRef.current;
    const cardRect = card?.getBoundingClientRect();
    if (!card || !cardRect) return [];

    return rects.map((rect) => ({
      top: rect.top - cardRect.top + card.scrollTop,
      left: rect.left - cardRect.left + card.scrollLeft,
      width: rect.width,
      height: rect.height,
    }));
  };

  const syncSelectionState = (
    snapshot: CursorSnapshot,
    value: string,
    rect?: DOMRect | null,
    overlayRects: DOMRect[] = [],
  ) => {
    sourceSelectionRef.current = snapshot;
    const start = Math.min(snapshot.sourceStart, snapshot.sourceEnd);
    const end = Math.max(snapshot.sourceStart, snapshot.sourceEnd);
    const selectedMarkdown = value.slice(start, end);
    const card = editorCardRef.current;
    const cardRect = card?.getBoundingClientRect();
    const hasSelection = start !== end && selectedMarkdown.trim().length > 0;
    const top = rect && card && cardRect ? rect.top - cardRect.top + card.scrollTop - 40 : 0;
    const left = rect && card && cardRect ? rect.left - cardRect.left + card.scrollLeft : 0;

    setSelectionState({
      hasSelection,
      excerpt: getSelectionExcerpt(selectedMarkdown),
      top,
      left,
    });
    committedSelectionRef.current = hasSelection ? snapshot : null;
    setPromptSelectionRects(hasSelection ? mapOverlayRects(overlayRects) : []);
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

  const restoreAIPreGenerationMarkdown = (beforeMarkdown: string) => {
    aiControllersRef.current.forEach((controller) => controller.abort());
    aiControllersRef.current.clear();
    aiFlushTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    aiFlushTimersRef.current.clear();
    aiGenerationInFlightRef.current = false;
    aiPendingUndoRef.current = null;
    aiUndoEntryRef.current = null;
    setSelectionState({
      hasSelection: false,
      excerpt: '',
      top: 0,
      left: 0,
    });
    applyMarkdown(beforeMarkdown, 'ai');
  };

  const runAIStream = async (
    session: AIInsertSession,
    selectedMarkdown: string,
    userInstruction: string,
    fullDocumentMarkdown?: string,
  ) => {
    if (!document) return;

    const sessionId = `${document.id}:${session.prefix.length}`;
    clearAIResources(sessionId);

    const controller = new AbortController();
    aiControllersRef.current.set(sessionId, controller);

    let nextContent = '';
    const activeSession = session;

    const flushContent = () => {
      aiFlushTimersRef.current.delete(sessionId);
      const updatedMarkdown = updateAIInsertSession(activeSession, nextContent);

      if (updatedMarkdown !== markdownRef.current) {
        applyMarkdown(updatedMarkdown, 'ai');
      }
    };

    const scheduleFlush = () => {
      if (aiFlushTimersRef.current.has(sessionId)) return;
      aiFlushTimersRef.current.set(sessionId, window.setTimeout(flushContent, 160));
    };

    try {
      await streamAIText(
        aiSettings,
        {
          documentTitle: document.title,
          fullDocumentMarkdown: fullDocumentMarkdown ?? markdownRef.current,
          selectedMarkdown,
          userInstruction,
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
        applyMarkdown(removeAIInsertSession(activeSession), 'ai');
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
      applyMarkdown(removeAIInsertSession(activeSession), 'ai');
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

    const snapshot = committedSelectionRef.current ?? sourceSelectionRef.current;
    const start = Math.min(snapshot.sourceStart, snapshot.sourceEnd);
    const end = Math.max(snapshot.sourceStart, snapshot.sourceEnd);
    const currentMarkdown = markdownRef.current;
    const selectedMarkdown = currentMarkdown.slice(start, end);
    const userInstruction = aiPrompt.trim();

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
    committedSelectionRef.current = null;
    setIsAiPromptActive(false);
    setAiPrompt('');
    applyMarkdown(insertion.markdown, 'ai');
    aiGenerationInFlightRef.current = true;
    try {
      await runAIStream(insertion.session, selectedMarkdown, userInstruction, currentMarkdown);
    } finally {
      aiGenerationInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia('(max-width: 780px)');
    const updateViewport = () => setIsMobileViewport(media.matches);
    updateViewport();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', updateViewport);
      return () => media.removeEventListener('change', updateViewport);
    }

    media.addListener(updateViewport);
    return () => media.removeListener(updateViewport);
  }, []);

  useEffect(() => {
    markdownMapRef.current = buildMarkdownTextMap(document?.markdown ?? '');
    markdownRef.current = document?.markdown ?? '';
    aiPendingUndoRef.current = null;
    aiUndoEntryRef.current = null;
    committedSelectionRef.current = null;
    setIsAiPromptActive(false);
    setAiPrompt('');
    syncSelectionState(
      {
        sourceStart: 0,
        sourceEnd: 0,
        textStart: 0,
        textEnd: 0,
      },
      document?.markdown ?? '',
      null,
      [],
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
    if (!selectionState.hasSelection) {
      setIsAiPromptActive(false);
      return;
    }

    if (!isAiPromptActive) return;
    if (isMobileViewport) return;

    window.requestAnimationFrame(() => {
      const input = aiPromptInputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }, [isAiPromptActive, isMobileViewport, selectionState.hasSelection]);

  useEffect(() => {
    if (!isMobilePromptSheetVisible) return;

    window.requestAnimationFrame(() => {
      const input = aiPromptInputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }, [isMobilePromptSheetVisible]);

  useEffect(() => {
    if (!selectionState.hasSelection || !isAiPromptShellVisible) return;

    if (mode === 'source') {
      const textarea = sourceEditorRef.current;
      if (!textarea) return;

      const selectionEnd = Math.min(sourceSelectionRef.current.sourceEnd, textarea.value.length);
      textarea.setSelectionRange(selectionEnd, selectionEnd);
      textarea.blur();
      return;
    }

    window.getSelection()?.removeAllRanges();
  }, [isAiPromptShellVisible, mode, selectionState.hasSelection]);

  useEffect(() => {
    const editor = visualEditorRef.current?.querySelector<HTMLElement>('.ProseMirror');
    if (!editor) return;

    const shouldHideNativeSelection =
      mode === 'wysiwyg' && selectionState.hasSelection && isAiPromptShellVisible;

    editor.classList.toggle('ProseMirror-hideselection', shouldHideNativeSelection);

    return () => {
      editor.classList.remove('ProseMirror-hideselection');
    };
  }, [mode, selectionState.hasSelection, isAiPromptShellVisible, document?.id]);

  useEffect(() => {
    const measureNode = aiPromptMeasureRef.current;
    if (!measureNode) return;

    const nextWidth = Math.ceil(measureNode.getBoundingClientRect().width) + 2;
    setAiPromptWidth(Math.min(Math.max(nextWidth, 120), 420));
  }, [aiPrompt, isAiPromptActive]);

  useEffect(() => {
    aiControllersRef.current.forEach((controller) => controller.abort());
    aiControllersRef.current.clear();
    aiFlushTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    aiFlushTimersRef.current.clear();
    aiGenerationInFlightRef.current = false;
    aiPendingUndoRef.current = null;
    aiUndoEntryRef.current = null;
    committedSelectionRef.current = null;
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
      committedSelectionRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!document) return;

    if (mode === 'source') {
      const textarea = sourceEditorRef.current;
      if (!textarea) return;
      const nextStart = Math.min(sourceSelectionRef.current.sourceStart, textarea.value.length);
      const nextEnd = Math.min(sourceSelectionRef.current.sourceEnd, textarea.value.length);
      window.requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(nextStart, nextEnd);
      });
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 12;

    const restoreSelection = () => {
      if (cancelled || !visualEditorRef.current) return;

      const snapshot = sourceSelectionRef.current;
      restoreVisualSelection(visualEditorRef.current, snapshot);

      const restoredSnapshot = getSelectionTextSnapshotFromEditor(visualEditorRef.current);
      const hasRestoredSelection =
        restoredSnapshot &&
        restoredSnapshot.textStart === snapshot.textStart &&
        restoredSnapshot.textEnd === snapshot.textEnd;

      if (hasRestoredSelection || attempts >= maxAttempts) {
        return;
      }

      attempts += 1;
      window.requestAnimationFrame(restoreSelection);
    };

    window.requestAnimationFrame(restoreSelection);

    return () => {
      cancelled = true;
    };
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
      const selectionStart = Math.min(textStart, textEnd);
      const selectionEnd = Math.max(textStart, textEnd);
      const isCollapsed = textStart === textEnd;
      const collapsedSourceOffset = map.textToSourceEnd[textStart] ?? markdownLength;

      syncSelectionState(
        {
          sourceStart: isCollapsed
            ? collapsedSourceOffset
            : (map.textToSourceStart[selectionStart] ?? markdownLength),
          sourceEnd: isCollapsed
            ? collapsedSourceOffset
            : (map.textToSourceEnd[selectionEnd] ?? markdownLength),
          textStart,
          textEnd,
        },
        markdownRef.current,
        getVisualSelectionRect(visualEditorRef.current),
        getVisualSelectionClientRects(visualEditorRef.current),
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
      const key = event.key.toLowerCase();
      const isPromptInput = event.target === aiPromptInputRef.current;

      if (key === 'tab' && selectionState.hasSelection && !isPromptInput) {
        event.preventDefault();
        event.stopPropagation();
        setIsAiPromptActive((current) => !current);
        if (isAiPromptActive) {
          window.requestAnimationFrame(() => {
            aiTriggerButtonRef.current?.focus();
          });
        }
        return;
      }

      if (key === 'tab' && selectionState.hasSelection && isPromptInput) {
        event.preventDefault();
        event.stopPropagation();
        closeAiPrompt();
        return;
      }

      if (key === 'escape' && isPromptInput) {
        event.preventDefault();
        event.stopPropagation();
        closeAiPrompt();
        return;
      }

      if (!(event.metaKey || event.ctrlKey)) return;

      if (key === 'z' && !event.shiftKey) {
        const pendingUndo = aiPendingUndoRef.current;
        const undoEntry = aiUndoEntryRef.current;
        if (!document) return;

        const beforeMarkdown =
          pendingUndo?.documentId === document.id
            ? pendingUndo.beforeMarkdown
            : undoEntry?.documentId === document.id
              ? undoEntry.beforeMarkdown
              : null;

        if (!beforeMarkdown) return;

        event.preventDefault();
        event.stopPropagation();
        restoreAIPreGenerationMarkdown(beforeMarkdown);
        return;
      }

      if (key !== 'enter') return;
      if (!selectionState.hasSelection) return;

      event.preventDefault();
      event.stopPropagation();
      void handleAskAI();
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    selectionState.hasSelection,
    document?.id,
    aiSettings,
    mode,
    aiPrompt,
    isAiPromptActive,
    isMobileViewport,
  ]);

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
      sourceEditorRef.current
        ? getTextareaSelectionClientRects(sourceEditorRef.current, selectionStart, selectionEnd)
        : [],
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
              onClick={onSaveNow}
              title="立即保存"
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
          className={`editor-card ${mode === 'source' ? 'is-source-mode' : ''} ${
            promptSelectionRects.length > 0 && isAiPromptShellVisible ? 'has-selection-overlay' : ''
          }`}
          ref={editorCardRef}
        >
          {promptSelectionRects.length > 0 && isAiPromptShellVisible ? (
            <div className="ai-selection-overlay" aria-hidden="true">
              {promptSelectionRects.map((rect, index) => (
                <div
                  className="ai-selection-overlay-rect"
                  key={`${index}:${rect.top}:${rect.left}:${rect.width}`}
                  style={{
                    top: `${rect.top}px`,
                    left: `${rect.left}px`,
                    width: `${rect.width}px`,
                    height: `${rect.height}px`,
                  }}
                />
              ))}
            </div>
          ) : null}
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
            <div
              className={`ai-selection-trigger ${
                isAiPromptActive ? 'is-prompt-active' : ''
              } ${isAiPromptShellVisible ? 'has-prompt-shell' : ''}`}
              style={{
                top: `${Math.max(selectionState.top, 8)}px`,
                left: `${Math.max(selectionState.left, 8)}px`,
              }}
            >
              <button
                className="ai-selection-trigger-button"
                disabled={!aiReady}
                onClick={handleAiTriggerClick}
                ref={aiTriggerButtonRef}
                title={
                  aiReady
                    ? isMobileViewport
                      ? '为当前选区补充 prompt'
                      : '基于当前选区生成，快捷键 Cmd/Ctrl+Enter'
                    : '先去设置里填写 AI provider / model / key'
                }
                type="button"
              >
                <span>问 AI</span>
                {isMobileViewport ? null : <kbd>⌘↵</kbd>}
              </button>
              {isMobileViewport ? null : (
                <div className="ai-selection-prompt-rail">
                  <div className="ai-selection-prompt-wrap" style={{ width: `${aiPromptWidth}px` }}>
                    <span className="ai-selection-prompt-measure" ref={aiPromptMeasureRef}>
                      {aiPrompt || '补充 prompt'}
                    </span>
                    <input
                      className="ai-selection-prompt"
                      onChange={(event) => setAiPrompt(event.target.value)}
                      onFocus={openAiPrompt}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          closeAiPrompt();
                          return;
                        }
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void handleAskAI();
                        }
                      }}
                      placeholder="补充 prompt"
                      ref={aiPromptInputRef}
                      size={Math.max(aiPrompt.length, 1)}
                      tabIndex={isAiPromptActive ? 0 : -1}
                      title="可选：补充这次 AI 生成要求"
                      type="text"
                      value={aiPrompt}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
        {isMobilePromptSheetVisible ? (
          <>
            <button
              aria-label="关闭 AI prompt"
              className="ai-mobile-sheet-backdrop"
              onClick={closeAiPrompt}
              type="button"
            />
            <div className="ai-mobile-sheet" role="dialog" aria-modal="true" aria-label="AI prompt">
              <div className="ai-mobile-sheet-handle" aria-hidden="true" />
              <div className="ai-mobile-sheet-header">
                <div>
                  <p className="ai-mobile-sheet-eyebrow">当前选区</p>
                  <h3>补充这次问 AI 的要求</h3>
                </div>
                <button className="ghost-button" onClick={closeAiPrompt} type="button">
                  关闭
                </button>
              </div>
              <input
                className="ai-mobile-sheet-input"
                onChange={(event) => setAiPrompt(event.target.value)}
                onFocus={openAiPrompt}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeAiPrompt();
                    return;
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleAskAI();
                  }
                }}
                placeholder="补充 prompt，可选"
                ref={aiPromptInputRef}
                title="可选：补充这次 AI 生成要求"
                type="text"
                value={aiPrompt}
              />
              <button
                className="primary-button ai-mobile-sheet-submit"
                disabled={!aiReady}
                onClick={() => void handleAskAI()}
                type="button"
              >
                发送
              </button>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
};

export { EditorPane };
export default EditorPane;
