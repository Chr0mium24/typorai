const PYODIDE_VERSION = '0.28.2';
const PYODIDE_BASE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const PYODIDE_SCRIPT_URL = `${PYODIDE_BASE_URL}pyodide.js`;

type PyodideGlobal = {
  loadPackagesFromImports(code: string): Promise<void>;
  runPythonAsync(code: string): Promise<unknown>;
  setStdout(options?: { batched?: (value: string) => void }): void;
  setStderr(options?: { batched?: (value: string) => void }): void;
  setStdin(options?: { error?: boolean }): void;
};

declare global {
  interface Window {
    loadPyodide?: (options?: { indexURL?: string }) => Promise<PyodideGlobal>;
  }
}

export type PythonRunResult = {
  output: string;
  error?: string;
};

let scriptLoadingPromise: Promise<void> | null = null;
let pyodideLoadingPromise: Promise<PyodideGlobal> | null = null;

const loadPyodideScript = () => {
  if (window.loadPyodide) return Promise.resolve();
  if (scriptLoadingPromise) return scriptLoadingPromise;

  scriptLoadingPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${PYODIDE_SCRIPT_URL}"]`,
    );

    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load Pyodide runtime.')),
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.src = PYODIDE_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Pyodide runtime.'));
    document.head.appendChild(script);
  });

  return scriptLoadingPromise;
};

export const getPyodide = async () => {
  if (pyodideLoadingPromise) return pyodideLoadingPromise;

  pyodideLoadingPromise = (async () => {
    await loadPyodideScript();

    if (!window.loadPyodide) {
      throw new Error('Pyodide loader is unavailable.');
    }

    const pyodide = await window.loadPyodide({
      indexURL: PYODIDE_BASE_URL,
    });
    pyodide.setStdin({ error: true });
    return pyodide;
  })();

  return pyodideLoadingPromise;
};

const normalizeResult = (result: unknown) => {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result;

  if (
    typeof result === 'object' &&
    result !== null &&
    'toString' in result &&
    typeof result.toString === 'function'
  ) {
    return result.toString();
  }

  return String(result);
};

export const runPythonCode = async (code: string): Promise<PythonRunResult> => {
  const pyodide = await getPyodide();
  const stdout: string[] = [];
  const stderr: string[] = [];

  pyodide.setStdout({
    batched: (value) => {
      stdout.push(value);
    },
  });

  pyodide.setStderr({
    batched: (value) => {
      stderr.push(value);
    },
  });

  try {
    await pyodide.loadPackagesFromImports(code);
    const result = await pyodide.runPythonAsync(code);
    const rendered = normalizeResult(result);
    const output = [...stdout, rendered].filter(Boolean).join('\n');
    return {
      output: output || 'Done.',
      ...(stderr.length > 0 ? { error: stderr.join('\n') } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      output: stdout.join('\n'),
      error: [...stderr, message].filter(Boolean).join('\n'),
    };
  } finally {
    pyodide.setStdout();
    pyodide.setStderr();
  }
};

export const getPyodideInfo = () => ({
  version: PYODIDE_VERSION,
  scriptUrl: PYODIDE_SCRIPT_URL,
});
