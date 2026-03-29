import { Fragment, type RefObject, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkspaceSession } from '../../types/workspace';
import { runPythonCode } from '../../lib/pyodide-runtime';
import { extractPythonBlocks } from '../../lib/python-blocks';
import { PlayIcon } from '../icons';

type PythonDecorationsProps = {
  markdown: string;
  mode: WorkspaceSession['editorMode'];
  rootRef: RefObject<HTMLDivElement>;
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

const pythonOutputHostSelector = '.python-inline-output-host';

const getEscapedHtml = (value: string) =>
  value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] ?? char));

const getCodeNodeContent = (node: HTMLElement) => {
  if (node.classList.contains('cm-content')) {
    return Array.from(node.querySelectorAll<HTMLElement>('.cm-line'))
      .map((line) => line.textContent ?? '')
      .join('\n')
      .replace(/\n$/, '');
  }

  return (node.textContent ?? '').replace(/\n$/, '');
};

const PythonDecorations = ({ markdown, mode, rootRef }: PythonDecorationsProps) => {
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

            {state.status !== 'idle'
              ? createPortal(
                  <div
                    className={`python-inline-output ${state.error ? 'has-error' : ''} ${
                      state.status === 'running' ? 'is-running' : ''
                    }`}
                  >
                    <div className="python-inline-output-meta">
                      <span className="python-inline-output-label">
                        {state.error
                          ? 'Error'
                          : state.status === 'running'
                            ? 'Running'
                            : 'Output'}
                      </span>
                      <span className="python-inline-output-state">
                        {state.status === 'running'
                          ? 'Executing Python'
                          : state.error
                            ? 'Execution Failed'
                            : 'Execution Complete'}
                      </span>
                    </div>
                    {state.status === 'running' ? <pre>Running...</pre> : null}
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
              : null}
          </Fragment>
        );
      })}
    </>
  );
};

export { PythonDecorations };
