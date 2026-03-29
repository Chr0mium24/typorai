import { useEffect, useRef } from 'react';
import { languages as codeMirrorLanguages } from '@codemirror/language-data';
import { Crepe } from '@milkdown/crepe';
import { restoreDisplayMathMarkdown } from '../../lib/markdown-math';

type MilkdownSurfaceProps = {
  markdown: string;
  active: boolean;
  onChange: (markdown: string) => void;
};

const preferredLanguageOrder = [
  'Shell',
  'PowerShell',
  'JavaScript',
  'Python',
  'TypeScript',
  'C++',
] as const;

const codeBlockLanguages = preferredLanguageOrder
  .map((name) => codeMirrorLanguages.find((language) => language.name === name) ?? null)
  .filter((language): language is (typeof codeMirrorLanguages)[number] => Boolean(language));

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

export { MilkdownSurface };
