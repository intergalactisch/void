import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Node as PmNode } from 'prosemirror-model';
import {
  createBundledHighlighter,
  type HighlighterGeneric,
  type ThemedTokenWithVariants,
} from 'shiki/core';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import {
  normalizeCodeLanguageForHighlighter,
  parseCodeBlockDisplayOptions,
} from '$lib/core/codeFence';

const MAX_HIGHLIGHT_CHARS = 24_000;
const MAX_HIGHLIGHT_LINES = 800;
const LIGHT_THEME = 'github-light';
const DARK_THEME = 'github-dark';
const LANGUAGE_LOADERS = {
  bash: () => import('@shikijs/langs/bash'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  css: () => import('@shikijs/langs/css'),
  dart: () => import('@shikijs/langs/dart'),
  diff: () => import('@shikijs/langs/diff'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  elixir: () => import('@shikijs/langs/elixir'),
  go: () => import('@shikijs/langs/go'),
  graphql: () => import('@shikijs/langs/graphql'),
  html: () => import('@shikijs/langs/html'),
  ini: () => import('@shikijs/langs/ini'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsx: () => import('@shikijs/langs/jsx'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  lua: () => import('@shikijs/langs/lua'),
  makefile: () => import('@shikijs/langs/makefile'),
  markdown: () => import('@shikijs/langs/markdown'),
  php: () => import('@shikijs/langs/php'),
  python: () => import('@shikijs/langs/python'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  scss: () => import('@shikijs/langs/scss'),
  sql: () => import('@shikijs/langs/sql'),
  svelte: () => import('@shikijs/langs/svelte'),
  swift: () => import('@shikijs/langs/swift'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  vue: () => import('@shikijs/langs/vue'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml'),
  zig: () => import('@shikijs/langs/zig'),
} as const;
const THEME_LOADERS = {
  [LIGHT_THEME]: () => import('@shikijs/themes/github-light'),
  [DARK_THEME]: () => import('@shikijs/themes/github-dark'),
} as const;
const createHighlighter = createBundledHighlighter({
  langs: LANGUAGE_LOADERS,
  themes: THEME_LOADERS,
  engine: createJavaScriptRegexEngine,
});

type SupportedLanguage = keyof typeof LANGUAGE_LOADERS;
type SupportedTheme = keyof typeof THEME_LOADERS;
const SUPPORTED_LANGUAGES = new Set<string>(Object.keys(LANGUAGE_LOADERS));

interface HighlightResult {
  key: string;
  tokens: HighlightToken[];
  skipped: boolean;
}

interface HighlightToken {
  from: number;
  to: number;
  style: string;
  className: string;
}

export const codeHighlightPluginKey = new PluginKey<DecorationSet>('void-code-highlight');

let highlighterPromise: Promise<HighlighterGeneric<SupportedLanguage, SupportedTheme>> | null = null;
const failedLanguages = new Set<string>();

export function createCodeHighlightPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: codeHighlightPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, value) {
        const meta = tr.getMeta(codeHighlightPluginKey) as DecorationSet | undefined;
        if (meta) return meta;
        return tr.docChanged ? value.map(tr.mapping, tr.doc) : value;
      },
    },
    props: {
      decorations(state) {
        return codeHighlightPluginKey.getState(state) ?? DecorationSet.empty;
      },
    },
    view(view) {
      return new CodeHighlightView(view);
    },
  });
}

class CodeHighlightView {
  private cache = new Map<string, HighlightResult>();
  private pending = new Set<string>();
  private destroyed = false;
  private refreshQueued = false;

  constructor(private view: EditorView) {
    this.scheduleForState(view.state);
    this.queueRefresh();
  }

  update(view: EditorView, previousState: EditorState): void {
    this.view = view;
    if (view.state.doc === previousState.doc) return;
    this.scheduleForState(view.state);
    this.queueRefresh();
  }

  destroy(): void {
    this.destroyed = true;
    this.pending.clear();
  }

  private scheduleForState(state: EditorState): void {
    state.doc.descendants((node) => {
      if (node.type.name !== 'codeBlock') return true;
      const key = keyForNode(node);
      if (this.cache.has(key) || this.pending.has(key)) return false;

      this.pending.add(key);
      void highlightCodeBlock(node, key).then((result) => {
        this.pending.delete(key);
        this.cache.set(key, result);
        this.queueRefresh();
      });
      return false;
    });
  }

  private queueRefresh(): void {
    if (this.destroyed || this.refreshQueued) return;
    this.refreshQueued = true;
    const schedule =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (callback: FrameRequestCallback) => globalThis.setTimeout(() => callback(Date.now()), 16);
    schedule(() => {
      this.refreshQueued = false;
      if (this.destroyed) return;
      this.view.dispatch(
        this.view.state.tr.setMeta(
          codeHighlightPluginKey,
          buildDecorations(this.view.state.doc, this.cache),
        ),
      );
    });
  }
}

async function highlightCodeBlock(node: PmNode, key: string): Promise<HighlightResult> {
  const code = node.textContent;
  const lineCount = code.split('\n').length;
  if (!code || code.length > MAX_HIGHLIGHT_CHARS || lineCount > MAX_HIGHLIGHT_LINES) {
    return { key, tokens: [], skipped: true };
  }

  const language = resolveSupportedLanguage(
    normalizeCodeLanguageForHighlighter(node.attrs.language as string | null),
  );
  if (!language) return { key, tokens: [], skipped: true };

  try {
    const highlighter = await getHighlighter();
    if (
      !highlighter.getLoadedLanguages().includes(language) &&
      !failedLanguages.has(language)
    ) {
      try {
        await highlighter.loadLanguage(language);
      } catch {
        failedLanguages.add(language);
      }
    }

    if (failedLanguages.has(language)) {
      return { key, tokens: [], skipped: true };
    }

    const lines = highlighter.codeToTokensWithThemes(code, {
      lang: language,
      themes: {
        light: LIGHT_THEME,
        dark: DARK_THEME,
      },
    });

    return {
      key,
      skipped: false,
      tokens: flattenTokens(lines),
    };
  } catch {
    return { key, tokens: [], skipped: true };
  }
}

function buildDecorations(
  doc: PmNode,
  cache: Map<string, HighlightResult>
): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true;
    const codeStart = pos + 1;
    const result = cache.get(keyForNode(node));
    decorations.push(...buildLineStateDecorations(node, codeStart));
    if (!result || result.skipped) return false;

    for (const token of result.tokens) {
      if (token.from === token.to) continue;
      decorations.push(
        Decoration.inline(
          codeStart + token.from,
          codeStart + token.to,
          {
            class: token.className,
            style: token.style,
          },
        ),
      );
    }
    return false;
  });

  return DecorationSet.create(doc, decorations);
}

function buildLineStateDecorations(node: PmNode, codeStart: number): Decoration[] {
  const decorations: Decoration[] = [];
  const code = node.textContent;
  if (!code) return decorations;

  const display = parseCodeBlockDisplayOptions(node.attrs.meta as string | null, code);
  let offset = 0;
  const lines = code.split('\n');
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const classes: string[] = [];
    if (display.highlightLines.has(lineNumber)) classes.push('void-code-line-highlight');
    if (display.focusLines.has(lineNumber)) classes.push('void-code-line-focus');
    if (/^\+/.test(line)) classes.push('void-code-line-diff-add');
    if (/^-/.test(line)) classes.push('void-code-line-diff-remove');

    if (classes.length > 0) {
      const lineLength = Math.max(1, line.length);
      decorations.push(
        Decoration.inline(
          codeStart + offset,
          codeStart + Math.min(code.length, offset + lineLength),
          { class: classes.join(' ') },
        ),
      );
    }
    offset += line.length + 1;
  });

  return decorations;
}

function keyForNode(node: PmNode): string {
  const language = (node.attrs.language as string | null) ?? '';
  const meta = (node.attrs.meta as string | null) ?? '';
  return `${language}\u0000${meta}\u0000${node.textContent}`;
}

function flattenTokens(lines: ThemedTokenWithVariants[][]): HighlightToken[] {
  const tokens: HighlightToken[] = [];

  for (const line of lines) {
    for (const token of line) {
      const from = token.offset;
      const to = from + token.content.length;
      const style = styleForToken(token);
      tokens.push({
        from,
        to,
        style,
        className: classNameForToken(token),
      });
    }
  }

  return tokens;
}

function styleForToken(token: ThemedTokenWithVariants): string {
  const light = token.variants.light;
  const dark = token.variants.dark;
  const styles = [
    light?.color ? `--void-code-token-light:${light.color}` : '',
    dark?.color ? `--void-code-token-dark:${dark.color}` : '',
  ].filter(Boolean);
  return styles.join(';');
}

function classNameForToken(token: ThemedTokenWithVariants): string {
  const light = token.variants.light;
  const classes = ['void-code-token'];
  if (light?.fontStyle) classes.push(`void-code-token-style-${light.fontStyle}`);
  return classes.join(' ');
}

function resolveSupportedLanguage(language: string): SupportedLanguage | null {
  return SUPPORTED_LANGUAGES.has(language) ? (language as SupportedLanguage) : null;
}

function getHighlighter(): Promise<HighlighterGeneric<SupportedLanguage, SupportedTheme>> {
  highlighterPromise ??= createHighlighter({
    themes: [LIGHT_THEME, DARK_THEME],
    langs: [],
  });
  return highlighterPromise;
}
