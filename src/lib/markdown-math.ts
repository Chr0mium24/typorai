const fencePattern = /^ {0,3}(```+|~~~+)/;

const hasUnescapedDollar = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '$') continue;
    if (index > 0 && value[index - 1] === '\\') continue;
    return true;
  }

  return false;
};

export const restoreDisplayMathMarkdown = (markdown: string) => {
  const lines = markdown.split('\n');
  const nextLines: string[] = [];
  let inFence = false;

  lines.forEach((line) => {
    if (fencePattern.test(line)) {
      inFence = !inFence;
      nextLines.push(line);
      return;
    }

    if (inFence) {
      nextLines.push(line);
      return;
    }

    const trimmed = line.trim();
    if (
      trimmed.startsWith('$') &&
      trimmed.endsWith('$') &&
      !trimmed.startsWith('$$') &&
      !trimmed.endsWith('$$')
    ) {
      const content = trimmed.slice(1, -1);
      if (content.length > 0 && !hasUnescapedDollar(content)) {
        const indent = line.slice(0, line.indexOf(trimmed));
        nextLines.push(`${indent}$$${content}$$`);
        return;
      }
    }

    nextLines.push(line);
  });

  return nextLines.join('\n');
};
