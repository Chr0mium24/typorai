import type { AISettings } from '../types/workspace';

export type AIStreamRequest = {
  documentTitle: string;
  fullDocumentMarkdown: string;
  selectedMarkdown: string;
  userInstruction: string;
};

const joinUrl = (baseUrl: string, path: string) => {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
};

const readResponseText = async (response: Response) => {
  const text = await response.text();
  try {
    const payload = JSON.parse(text) as { error?: { message?: string } };
    return payload.error?.message ?? text;
  } catch {
    return text;
  }
};

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

const parseSSE = async (
  response: Response,
  onData: (payload: string) => void,
  signal?: AbortSignal,
) => {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('当前浏览器不支持流式响应。');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let eventDataLines: string[] = [];

  const flushEvent = () => {
    if (eventDataLines.length === 0) return;
    const data = eventDataLines.join('\n').trim();
    eventDataLines = [];
    if (!data || data === '[DONE]') return;
    onData(data);
  };

  while (true) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let lineBreakMatch = buffer.match(/\r?\n/);
    while (lineBreakMatch) {
      const newlineIndex = lineBreakMatch.index ?? 0;
      const newlineLength = lineBreakMatch[0].length;
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + newlineLength);

      if (line === '') {
        flushEvent();
      } else if (line.startsWith('data:')) {
        eventDataLines.push(line.slice(5).trimStart());
      }

      lineBreakMatch = buffer.match(/\r?\n/);
    }

    if (done) break;
  }

  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail.startsWith('data:')) {
    eventDataLines.push(tail.slice(5).trimStart());
  }

  flushEvent();
};

const getOpenAIMessageDelta = (payload: string) => {
  const json = JSON.parse(payload) as {
    choices?: Array<{
      delta?: {
        content?: string | Array<{ type?: string; text?: string }>;
      };
    }>;
  };

  const content = json.choices?.[0]?.delta?.content;
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .map((item) => (item.type === 'text' ? item.text ?? '' : item.text ?? ''))
    .join('');
};

const getGeminiDelta = (payload: string) => {
  const json = JSON.parse(payload) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  return (
    json.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('') ?? ''
  );
};

const buildUserPrompt = ({
  documentTitle,
  fullDocumentMarkdown,
  selectedMarkdown,
  userInstruction,
}: AIStreamRequest) => {
  return [
    '你要在当前选中内容后方继续创作一个新的文档块。',
    `文档标题：${documentTitle || 'Untitled note'}`,
    '',
    '全文 markdown：',
    fullDocumentMarkdown,
    '',
    '当前选中的 markdown：',
    selectedMarkdown,
    '',
    '用户要求：',
    userInstruction || '基于选中内容继续写，延续语气和结构。',
    '',
    '要求：',
    '1. 只输出应该插入文档的 markdown 内容。',
    '2. 不要解释，不要加“当然可以”。',
    '3. 默认生成一个自然衔接的新块，不改写选中原文。',
  ].join('\n');
};

export const hasAIConfig = (settings: AISettings) => {
  if (settings.provider === 'openai-compatible') {
    return Boolean(
      settings.openAICompatible.baseUrl.trim() &&
        settings.openAICompatible.apiKey.trim() &&
        settings.openAICompatible.model.trim(),
    );
  }

  return Boolean(
    settings.gemini.baseUrl.trim() &&
      settings.gemini.apiKey.trim() &&
      settings.gemini.model.trim(),
  );
};

export const streamAIText = async (
  settings: AISettings,
  request: AIStreamRequest,
  onText: (delta: string) => void,
  signal?: AbortSignal,
) => {
  const userPrompt = buildUserPrompt(request);

  if (settings.provider === 'openai-compatible') {
    const response = await fetch(
      joinUrl(settings.openAICompatible.baseUrl, '/v1/chat/completions'),
      {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.openAICompatible.apiKey}`,
        },
        body: JSON.stringify({
          model: settings.openAICompatible.model,
          temperature: settings.temperature,
          max_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
          stream: true,
          messages: [
            {
              role: 'system',
              content: settings.systemPrompt,
            },
            {
              role: 'user',
              content: userPrompt,
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      throw new Error(await readResponseText(response));
    }

    await parseSSE(
      response,
      (payload) => {
        const delta = getOpenAIMessageDelta(payload);
        if (delta) onText(delta);
      },
      signal,
    );
    return;
  }

  const model = encodeURIComponent(settings.gemini.model.trim());
  const response = await fetch(
    `${joinUrl(
      settings.gemini.baseUrl,
      `/v1beta/models/${model}:streamGenerateContent`,
    )}?alt=sse&key=${encodeURIComponent(settings.gemini.apiKey)}`,
    {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: settings.systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: settings.temperature,
          maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await readResponseText(response));
  }

  let emittedText = '';

  await parseSSE(
    response,
    (payload) => {
      const chunkText = getGeminiDelta(payload);
      if (!chunkText) return;

      if (chunkText.startsWith(emittedText)) {
        const delta = chunkText.slice(emittedText.length);
        emittedText = chunkText;
        if (delta) onText(delta);
        return;
      }

      if (emittedText.endsWith(chunkText)) {
        return;
      }

      emittedText += chunkText;
      onText(chunkText);
    },
    signal,
  );
};
