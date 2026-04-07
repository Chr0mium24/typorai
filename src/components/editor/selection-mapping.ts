export type CursorSnapshot = {
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
      kind: 'atom';
      beforeBoundary: {
        node: Node;
        offset: number;
      };
      afterBoundary: {
        node: Node;
        offset: number;
      };
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

export type MarkdownTextMap = {
  sourceToText: number[];
  textToSourceStart: number[];
  textToSourceEnd: number[];
  textLength: number;
};

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

const zeroContributionRange = (
  textContribution: number[],
  start: number,
  end: number,
) => {
  for (let position = start; position < end; position += 1) {
    textContribution[position] = 0;
  }
};

const hasVisibleContribution = (
  textContribution: number[],
  start: number,
  length: number,
) => {
  for (let position = start; position < start + length; position += 1) {
    if (textContribution[position] !== 0) {
      return true;
    }
  }

  return false;
};

const isEscapedMarkdownCharacter = (value: string, index: number) => {
  let backslashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    backslashCount += 1;
  }

  return backslashCount % 2 === 1;
};

const isAsciiLetterOrDigit = (value?: string) => Boolean(value?.match(/[A-Za-z0-9]/));

const isMarkdownEscapableCharacter = (value?: string) =>
  Boolean(value?.match(/[\\`*_{}\[\]()#+\-.!~<>|]/));

const isProtectedOffset = (
  offset: number,
  protectedRanges: Array<{
    start: number;
    end: number;
  }>,
) => protectedRanges.some((range) => offset >= range.start && offset < range.end);

const isUnderscoreDelimiter = (token: string) => token[0] === '_';

const isValidUnderscoreDelimiterBoundary = (line: string, index: number, length: number) => {
  const previous = line[index - 1];
  const next = line[index + length];

  return !(isAsciiLetterOrDigit(previous) && isAsciiLetterOrDigit(next));
};

const findClosingBracket = (line: string, startIndex: number) => {
  let depth = 0;

  for (let index = startIndex; index < line.length; index += 1) {
    if (isEscapedMarkdownCharacter(line, index)) continue;

    if (line[index] === '[') {
      depth += 1;
      continue;
    }

    if (line[index] === ']') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
};

const findClosingParenthesis = (line: string, startIndex: number) => {
  let depth = 0;

  for (let index = startIndex; index < line.length; index += 1) {
    if (isEscapedMarkdownCharacter(line, index)) continue;

    if (line[index] === '(') {
      depth += 1;
      continue;
    }

    if (line[index] === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
};

const hideEscapedMarkdownSyntax = (
  line: string,
  lineStart: number,
  textContribution: number[],
  protectedRanges: Array<{
    start: number;
    end: number;
  }>,
) => {
  for (let index = 0; index < line.length - 1; index += 1) {
    if (line[index] !== '\\') continue;
    if (!isMarkdownEscapableCharacter(line[index + 1])) continue;
    if (isProtectedOffset(index, protectedRanges)) continue;

    textContribution[lineStart + index] = 0;
  }
};

const hideInlineCodeDelimiterVisibility = (
  line: string,
  lineStart: number,
  textContribution: number[],
  protectedRanges: Array<{
    start: number;
    end: number;
  }>,
) => {
  let index = 0;

  while (index < line.length) {
    if (line[index] !== '`' || isEscapedMarkdownCharacter(line, index)) {
      index += 1;
      continue;
    }

    let delimiterLength = 1;
    while (line[index + delimiterLength] === '`') {
      delimiterLength += 1;
    }

    const closingToken = '`'.repeat(delimiterLength);
    let closingIndex = line.indexOf(closingToken, index + delimiterLength);

    while (closingIndex >= 0 && isEscapedMarkdownCharacter(line, closingIndex)) {
      closingIndex = line.indexOf(closingToken, closingIndex + 1);
    }

    if (closingIndex < 0) {
      index += delimiterLength;
      continue;
    }

    zeroContributionRange(
      textContribution,
      lineStart + index,
      lineStart + index + delimiterLength,
    );
    zeroContributionRange(
      textContribution,
      lineStart + closingIndex,
      lineStart + closingIndex + delimiterLength,
    );
    protectedRanges.push({
      start: index + delimiterLength,
      end: closingIndex,
    });

    index = closingIndex + delimiterLength;
  }
};

const hideLinkSyntaxVisibility = (
  line: string,
  lineStart: number,
  textContribution: number[],
  protectedRanges: Array<{
    start: number;
    end: number;
  }>,
) => {
  let index = 0;

  while (index < line.length) {
    const isImage = line[index] === '!' && line[index + 1] === '[';
    const labelStart = isImage ? index + 1 : index;

    if (line[labelStart] !== '[' || isEscapedMarkdownCharacter(line, labelStart)) {
      index += 1;
      continue;
    }

    if (isProtectedOffset(labelStart, protectedRanges)) {
      index += 1;
      continue;
    }

    const labelEnd = findClosingBracket(line, labelStart);
    if (labelEnd < 0) {
      index += 1;
      continue;
    }

    if (line[labelEnd + 1] === '(') {
      const destinationEnd = findClosingParenthesis(line, labelEnd + 1);
      if (destinationEnd < 0) {
        index += 1;
        continue;
      }

      if (isImage) {
        textContribution[lineStart + index] = 0;
        zeroContributionRange(textContribution, lineStart + labelStart + 1, lineStart + labelEnd);
      }

      textContribution[lineStart + labelStart] = 0;
      textContribution[lineStart + labelEnd] = 0;
      zeroContributionRange(
        textContribution,
        lineStart + labelEnd + 1,
        lineStart + destinationEnd + 1,
      );
      index = destinationEnd + 1;
      continue;
    }

    if (line[labelEnd + 1] === '[') {
      const referenceEnd = findClosingBracket(line, labelEnd + 1);
      if (referenceEnd < 0) {
        index += 1;
        continue;
      }

      if (isImage) {
        textContribution[lineStart + index] = 0;
        zeroContributionRange(textContribution, lineStart + labelStart + 1, lineStart + labelEnd);
      }

      textContribution[lineStart + labelStart] = 0;
      textContribution[lineStart + labelEnd] = 0;
      zeroContributionRange(
        textContribution,
        lineStart + labelEnd + 1,
        lineStart + referenceEnd + 1,
      );
      index = referenceEnd + 1;
      continue;
    }

    index += 1;
  }
};

const hidePairedDelimiterVisibility = (
  line: string,
  lineStart: number,
  textContribution: number[],
  token: string,
  protectedRanges: Array<{
    start: number;
    end: number;
  }>,
) => {
  let index = 0;

  while (index <= line.length - token.length) {
    if (!line.startsWith(token, index) || isEscapedMarkdownCharacter(line, index)) {
      index += 1;
      continue;
    }

    if (!hasVisibleContribution(textContribution, lineStart + index, token.length)) {
      index += 1;
      continue;
    }

    if (isProtectedOffset(index, protectedRanges)) {
      index += 1;
      continue;
    }

    if (isUnderscoreDelimiter(token) && !isValidUnderscoreDelimiterBoundary(line, index, token.length)) {
      index += 1;
      continue;
    }

    let closingIndex = index + token.length;
    while (closingIndex <= line.length - token.length) {
      if (!line.startsWith(token, closingIndex) || isEscapedMarkdownCharacter(line, closingIndex)) {
        closingIndex += 1;
        continue;
      }

      if (!hasVisibleContribution(textContribution, lineStart + closingIndex, token.length)) {
        closingIndex += 1;
        continue;
      }

      if (isProtectedOffset(closingIndex, protectedRanges)) {
        closingIndex += 1;
        continue;
      }

      if (
        isUnderscoreDelimiter(token) &&
        !isValidUnderscoreDelimiterBoundary(line, closingIndex, token.length)
      ) {
        closingIndex += 1;
        continue;
      }

      const content = line.slice(index + token.length, closingIndex);
      if (!content.trim()) {
        closingIndex += 1;
        continue;
      }

      zeroContributionRange(
        textContribution,
        lineStart + index,
        lineStart + index + token.length,
      );
      zeroContributionRange(
        textContribution,
        lineStart + closingIndex,
        lineStart + closingIndex + token.length,
      );

      index = closingIndex + token.length;
      break;
    }

    if (closingIndex > line.length - token.length) {
      index += token.length;
    }
  }
};

const hideReferenceDefinitionVisibility = (
  line: string,
  lineStart: number,
  textContribution: number[],
) => {
  const referenceDefinitionPattern = /^ {0,3}\[[^\]]+\]:(?:\s+|$)/;

  if (!referenceDefinitionPattern.test(line)) {
    return;
  }

  zeroContributionRange(textContribution, lineStart, lineStart + line.length);
};

const hideInlineHtmlTagVisibility = (
  line: string,
  lineStart: number,
  textContribution: number[],
  protectedRanges: Array<{
    start: number;
    end: number;
  }>,
) => {
  const tagPattern = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*?)?>/g;

  for (const match of line.matchAll(tagPattern)) {
    const matchStart = match.index ?? -1;
    if (matchStart < 0) continue;
    if (isProtectedOffset(matchStart, protectedRanges)) continue;
    if (match[0].includes('://')) continue;

    zeroContributionRange(
      textContribution,
      lineStart + matchStart,
      lineStart + matchStart + match[0].length,
    );
  }
};

const findMathDelimiterEnd = (
  line: string,
  startIndex: number,
  delimiterLength: 1 | 2,
) => {
  for (let index = startIndex; index < line.length; index += 1) {
    if (line[index] !== '$') continue;
    if (isEscapedMarkdownCharacter(line, index)) continue;

    if (delimiterLength === 2) {
      if (line[index + 1] === '$') {
        return index;
      }
      continue;
    }

    if (line[index + 1] !== '$') {
      return index;
    }
  }

  return -1;
};

const hideMathDelimiterVisibility = (
  line: string,
  lineStart: number,
  textContribution: number[],
  protectedRanges?: Array<{
    start: number;
    end: number;
  }>,
) => {
  const trimmed = line.trim();

  if (trimmed === '$$') {
    const delimiterStart = line.indexOf('$$');
    if (delimiterStart >= 0) {
      textContribution[lineStart + delimiterStart] = 0;
      textContribution[lineStart + delimiterStart + 1] = 0;
    }
    return;
  }

  let index = 0;

  while (index < line.length) {
    if (line[index] !== '$' || isEscapedMarkdownCharacter(line, index)) {
      index += 1;
      continue;
    }

    const delimiterLength = line[index + 1] === '$' ? 2 : 1;
    const contentStart = index + delimiterLength;
    const delimiterEnd = findMathDelimiterEnd(
      line,
      contentStart,
      delimiterLength === 2 ? 2 : 1,
    );

    if (delimiterEnd < 0) {
      index = contentStart;
      continue;
    }

    for (let offset = 0; offset < delimiterLength; offset += 1) {
      textContribution[lineStart + index + offset] = 0;
      textContribution[lineStart + delimiterEnd + offset] = 0;
    }

    protectedRanges?.push({
      start: index + delimiterLength,
      end: delimiterEnd,
    });

    index = delimiterEnd + delimiterLength;
  }
};

const collapseHtmlBreakTags = (
  line: string,
  lineStart: number,
  textContribution: number[],
) => {
  const breakPattern = /<\/?br\s*\/?>/gi;

  for (const match of line.matchAll(breakPattern)) {
    const matchStart = match.index ?? -1;
    if (matchStart < 0) continue;

    const tag = match[0];
    for (let offset = 0; offset < tag.length; offset += 1) {
      textContribution[lineStart + matchStart + offset] = 0;
    }
  }
};

export const buildMarkdownTextMap = (markdown: string): MarkdownTextMap => {
  const sourceToText = new Array<number>(markdown.length + 1).fill(0);
  const textContribution = new Array<number>(markdown.length).fill(0);
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
          textContribution[position] = 1;
        }
        if (newlineIndex >= 0) {
          textContribution[newlineIndex] = 1;
        }
      }
    } else if (fencePattern.test(line)) {
      inFence = true;
    } else if (!hrPattern.test(line.trim()) && !commentPattern.test(line.trim())) {
      const prefixLength = getLinePrefixLength(line);
      const protectedRanges: Array<{
        start: number;
        end: number;
      }> = [];

      for (
        let position = lineStart + Math.min(prefixLength, line.length);
        position < lineEnd;
        position += 1
      ) {
        textContribution[position] = 1;
      }

      hideReferenceDefinitionVisibility(line, lineStart, textContribution);
      hideMathDelimiterVisibility(line, lineStart, textContribution, protectedRanges);
      hideInlineCodeDelimiterVisibility(line, lineStart, textContribution, protectedRanges);
      hideLinkSyntaxVisibility(line, lineStart, textContribution, protectedRanges);
      hideEscapedMarkdownSyntax(line, lineStart, textContribution, protectedRanges);
      hidePairedDelimiterVisibility(line, lineStart, textContribution, '***', protectedRanges);
      hidePairedDelimiterVisibility(line, lineStart, textContribution, '___', protectedRanges);
      hidePairedDelimiterVisibility(line, lineStart, textContribution, '~~', protectedRanges);
      hidePairedDelimiterVisibility(line, lineStart, textContribution, '**', protectedRanges);
      hidePairedDelimiterVisibility(line, lineStart, textContribution, '__', protectedRanges);
      hidePairedDelimiterVisibility(line, lineStart, textContribution, '*', protectedRanges);
      hidePairedDelimiterVisibility(line, lineStart, textContribution, '_', protectedRanges);
      collapseHtmlBreakTags(line, lineStart, textContribution);
      hideInlineHtmlTagVisibility(line, lineStart, textContribution, protectedRanges);
    }

    index = newlineIndex >= 0 ? newlineIndex + 1 : lineEnd + 1;
  }

  let textLength = 0;

  for (let position = 0; position < markdown.length; position += 1) {
    sourceToText[position] = textLength;
    textLength += textContribution[position] ?? 0;
    sourceToText[position + 1] = textLength;
  }

  const textToSourceStart = new Array<number>(textLength + 1).fill(markdown.length);
  const textToSourceEnd = new Array<number>(textLength + 1).fill(0);
  for (let position = 0; position <= markdown.length; position += 1) {
    const textOffset = sourceToText[position];
    if (textToSourceStart[textOffset] === markdown.length) {
      textToSourceStart[textOffset] = position;
    }
    textToSourceEnd[textOffset] = position;
  }

  return {
    sourceToText,
    textToSourceStart,
    textToSourceEnd,
    textLength,
  };
};

export const getSourceCursorSnapshot = (
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

const getEditorAtomLength = (node: Node) => {
  if (!(node instanceof Element)) return null;
  if (!node.matches('[contenteditable="false"][data-value][data-type^="math"]')) {
    return null;
  }

  return node.getAttribute('data-value')?.length ?? 0;
};

const getEditorAtomElement = (node: Node) => {
  const element = node instanceof Element ? node : node.parentElement;
  if (!element) return null;

  return element.closest('[contenteditable="false"][data-value][data-type^="math"]');
};

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
  const atomLength = getEditorAtomLength(node);
  if (atomLength !== null) {
    return atomLength;
  }

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

const measureTextOffset = (root: Node, targetNode: Node, targetOffset: number): number => {
  const targetAtom = getEditorAtomElement(targetNode);
  const normalizedTargetNode = targetAtom ?? targetNode;
  const normalizedTargetOffset = targetAtom ? (targetOffset <= 0 ? 0 : 1) : targetOffset;
  let total = 0;

  const walk = (node: Node): boolean => {
    const atomLength = getEditorAtomLength(node);

    if (node === normalizedTargetNode) {
      if (atomLength !== null) {
        if (normalizedTargetOffset > 0) {
          total += atomLength;
        }
        return true;
      }

      if (isEditorTextNode(node)) {
        total += Math.min(normalizedTargetOffset, node.textContent?.length ?? 0);
      } else {
        const limit = Math.min(normalizedTargetOffset, node.childNodes.length);
        for (let index = 0; index < limit; index += 1) {
          total += getNodeTextLength(node.childNodes[index]);
        }
      }
      return true;
    }

    if (atomLength !== null) {
      total += atomLength;
      return false;
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
    const atomLength = getEditorAtomLength(node);
    if (atomLength !== null) {
      const parent = node.parentNode;
      if (parent) {
        const childIndex = Array.prototype.indexOf.call(parent.childNodes, node);
        segments.push({
          kind: 'atom',
          beforeBoundary: {
            node: parent,
            offset: childIndex,
          },
          afterBoundary: {
            node: parent,
            offset: childIndex + 1,
          },
          length: atomLength,
        });
        totalLength += atomLength;
      }
      return null;
    }

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

export const getSelectionTextSnapshotFromEditor = (
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

const getVisualSelectionRangeFromSnapshot = (
  container: HTMLDivElement,
  selectionSnapshot: Pick<CursorSnapshot, 'textStart' | 'textEnd'>,
) => {
  const editor = container.querySelector<HTMLElement>('.ProseMirror');
  if (!editor) return null;

  const { segments, totalLength } = collectEditorTextSegments(editor);

  const textSegments = segments.filter(
    (segment) => segment.kind === 'text',
  ) as Array<Extract<EditorTextSegment, { kind: 'text' }>>;

  if (textSegments.length === 0 || totalLength === 0) {
    return null;
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

        if (segment.kind === 'atom') {
          return normalizedTarget === consumed
            ? segment.beforeBoundary
            : segment.afterBoundary;
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

  return {
    range,
    totalLength,
    editor,
  };
};

export const getVisualSelectionRange = (
  container: HTMLDivElement,
  selectionSnapshot: Pick<CursorSnapshot, 'textStart' | 'textEnd'>,
) => getVisualSelectionRangeFromSnapshot(container, selectionSnapshot)?.range ?? null;

export const restoreVisualSelection = (
  container: HTMLDivElement,
  selectionSnapshot: Pick<CursorSnapshot, 'textStart' | 'textEnd'>,
) => {
  const selectionState = getVisualSelectionRangeFromSnapshot(container, selectionSnapshot);
  if (!selectionState) return;

  const { editor, range, totalLength } = selectionState;

  editor.focus();

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

export const getVisualSelectionRect = (container: HTMLDivElement) => {
  const editor = container.querySelector<HTMLElement>('.ProseMirror');
  const selection = window.getSelection();
  if (!editor || !selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (range.collapsed) return null;
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    return null;
  }

  const trailingRange = range.cloneRange();
  trailingRange.collapse(false);

  const trailingRects = trailingRange.getClientRects();
  const trailingRect =
    trailingRects[trailingRects.length - 1] ?? trailingRange.getBoundingClientRect();

  if (trailingRect.width !== 0 || trailingRect.height !== 0) {
    return trailingRect;
  }

  const fallbackRect = range.getBoundingClientRect();
  if (fallbackRect.width === 0 && fallbackRect.height === 0) return null;
  return fallbackRect;
};

export const getVisualSelectionClientRects = (container: HTMLDivElement) => {
  const editor = container.querySelector<HTMLElement>('.ProseMirror');
  const selection = window.getSelection();
  if (!editor || !selection || selection.rangeCount === 0) return [];

  const range = selection.getRangeAt(0);
  if (range.collapsed) return [];
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    return [];
  }

  return Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
};

export const getTextareaSelectionClientRects = (
  textarea: HTMLTextAreaElement,
  selectionStart: number,
  selectionEnd: number,
) => {
  if (selectionStart === selectionEnd) return [];

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

  mirror.append(textarea.value.slice(0, selectionStart));
  const selectedText = window.document.createElement('span');
  selectedText.textContent = textarea.value.slice(selectionStart, selectionEnd) || '\u200b';
  mirror.appendChild(selectedText);
  window.document.body.appendChild(mirror);

  const rects = Array.from(selectedText.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );

  mirror.remove();
  return rects;
};

export const getTextareaSelectionRect = (
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
