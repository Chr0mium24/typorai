export type AIInsertSession = {
  prefix: string;
  suffix: string;
};

export type AIUndoEntry = {
  documentId: string;
  beforeMarkdown: string;
  afterMarkdown: string;
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

const hasInlineInsertionContext = (markdown: string, index: number) => {
  if (index <= 0 || index >= markdown.length) return false;
  return markdown[index - 1] !== '\n' && markdown[index] !== '\n';
};

export const createAIInsertSession = (
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
  const isInlineInsertion = hasInlineInsertionContext(markdown, safeEnd);
  const leadingGap = isInlineInsertion ? '' : getLeadingGap(before);
  const trailingGap = isInlineInsertion ? '' : getTrailingGap(after);
  const prefix = `${before}${leadingGap}`;
  const suffix = `${trailingGap}${after}`;

  return {
    markdown: `${prefix}${suffix}`,
    session: {
      prefix,
      suffix,
    },
  };
};

export const updateAIInsertSession = (
  session: AIInsertSession,
  nextContent: string,
): string => `${session.prefix}${nextContent}${session.suffix}`;

export const removeAIInsertSession = (session: AIInsertSession) =>
  normalizeGeneratedBlockSpacing(`${session.prefix}${session.suffix}`);
