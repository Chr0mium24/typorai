export type PythonBlock = {
  id: string;
  code: string;
  lineStart: number;
};

const PYTHON_FENCE_PATTERN = /^```python\s*\n([\s\S]*?)^```/gm;

export const extractPythonBlocks = (markdown: string): PythonBlock[] => {
  const blocks: PythonBlock[] = [];
  let match: RegExpExecArray | null;

  while ((match = PYTHON_FENCE_PATTERN.exec(markdown)) !== null) {
    const source = match[0];
    const code = match[1].replace(/\n$/, '');
    const lineStart = markdown.slice(0, match.index).split('\n').length;

    blocks.push({
      id: `${lineStart}-${source.length}`,
      code,
      lineStart,
    });
  }

  return blocks;
};

