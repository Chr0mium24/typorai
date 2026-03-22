import { useMemo, useState } from 'react';
import { extractPythonBlocks } from '../lib/python-blocks';
import { getPyodideInfo, runPythonCode } from '../lib/pyodide-runtime';
import { RefreshIcon } from './icons';

type PythonRunnerProps = {
  markdown: string;
};

type BlockState = {
  status: 'idle' | 'running' | 'done' | 'error';
  output: string;
  error: string;
};

const initialBlockState: BlockState = {
  status: 'idle',
  output: '',
  error: '',
};

export const PythonRunner = ({ markdown }: PythonRunnerProps) => {
  const blocks = useMemo(() => extractPythonBlocks(markdown), [markdown]);
  const [states, setStates] = useState<Record<string, BlockState>>({});
  const pyodideInfo = getPyodideInfo();

  if (blocks.length === 0) return null;

  return (
    <section className="python-runner">
      <div className="python-runner-header">
        <div>
          <p className="eyebrow">Python Runner</p>
          <h3>{blocks.length} 个 Python 代码块</h3>
        </div>
        <span className="runner-meta">Pyodide {pyodideInfo.version}</span>
      </div>

      <div className="python-runner-list">
        {blocks.map((block, index) => {
          const state = states[block.id] ?? initialBlockState;
          return (
            <article className="python-runner-card" key={block.id}>
              <div className="python-runner-card-header">
                <div>
                  <strong>Python #{index + 1}</strong>
                  <span className="runner-location">第 {block.lineStart} 行</span>
                </div>
                <button
                  className={`icon-button ${state.status === 'running' ? 'is-active' : ''}`}
                  disabled={state.status === 'running'}
                  onClick={async () => {
                    setStates((current) => ({
                      ...current,
                      [block.id]: {
                        ...initialBlockState,
                        status: 'running',
                      },
                    }));

                    const result = await runPythonCode(block.code);

                    setStates((current) => ({
                      ...current,
                      [block.id]: {
                        status: result.error ? 'error' : 'done',
                        output: result.output,
                        error: result.error ?? '',
                      },
                    }));
                  }}
                  title="运行 Python"
                  type="button"
                >
                  <RefreshIcon width={14} height={14} />
                </button>
              </div>

              <pre className="python-code-preview">{block.code}</pre>

              {state.status !== 'idle' ? (
                <div className="python-output-panel">
                  {state.output ? (
                    <pre className="python-output">{state.output}</pre>
                  ) : null}
                  {state.error ? (
                    <pre className="python-error">{state.error}</pre>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
};
