/**
 * AIInlineCoordinator — owns the AI inline-generation flow.
 *
 * Extracted from ProseMirrorAdapter so the adapter shell can focus on
 * editor lifecycle, plugin orchestration, and command dispatch. The
 * coordinator handles the full Cmd+J / inline-prompt / generate
 * workflow:
 *
 *   1. `executeAIPromptSelection` — open the prompt input over the
 *      current text selection.
 *   2. `executeAIPromptSelectionAt` — same, but with explicit range
 *      (used when the editor knows the precise selection coordinates).
 *   3. `executeAIInlineGenerate` — lock the current block and start an
 *      async generate, keeping the real document unchanged until final apply.
 *   4. `handleAIInlinePromptSubmit` — lock the selection's block and run an
 *      async transform while keeping the original text visible.
 *   5. `handleAIInlineAccept` — commit any legacy preview result.
 *   6. `handleAIInlineRetry` — re-run the same prompt.
 *   7. `handleAIInlineDeny` — restore the original content.
 *
 * The coordinator never owns the EditorView. It reads it through the
 * `getView` getter the adapter passes in at construction time, so the
 * adapter retains exclusive control over view lifecycle. All mutations
 * flow through `view.dispatch(tr)` like the original code.
 */

import type { EditorView } from 'prosemirror-view';
import type { Node as PmNode } from 'prosemirror-model';

import { voidSchema } from './schema';
import {
  aiInlineKey,
  startAIInlineProcessing,
  showAIInlinePreview,
  reportAIInlineError,
  type AIInlineMeta,
  type AIInlineMode,
} from './plugins/aiInline';
import { parseMarkdown, renderMarkdownToHtml } from '../markdown/parser';
import { resolveVisibleBlock } from './commands/blockUtils';
import { aiBlockKey, AI_BYPASS, type AIBlockMeta } from './plugins/aiBlock';

/**
 * Async callback contract — same shape the adapter's
 * `onAIInlineGenerate` option used. The coordinator wires the
 * `onComplete`/`onError` continuations to the inline plugin so the host
 * never has to know about ProseMirror.
 */
export type AIInlineGenerateCallback = (
  prompt: string,
  selectionText: string | null,
  callbacks: {
    onComplete: (markdown: string) => void;
    onError: (msg: string) => void;
  },
) => void;

export interface AIInlineCoordinatorDeps {
  /** Get the current EditorView. Returns null when the adapter is unmounted. */
  getView: () => EditorView | null;
  /** Async AI hook supplied by the adapter's options. May be undefined. */
  onGenerate?: AIInlineGenerateCallback | undefined;
  /** Notify the adapter when an inline path has an active block target. */
  onActiveTarget?: ((blockId: string | null) => void) | undefined;
}

export class AIInlineCoordinator {
  private readonly getView: () => EditorView | null;
  private readonly onGenerate: AIInlineGenerateCallback | undefined;
  private readonly onActiveTarget: ((blockId: string | null) => void) | undefined;

  constructor(deps: AIInlineCoordinatorDeps) {
    this.getView = deps.getView;
    this.onGenerate = deps.onGenerate;
    this.onActiveTarget = deps.onActiveTarget;
  }

  // ─────────────────────────────────────────────────────────────────
  // Prompt opening
  // ─────────────────────────────────────────────────────────────────

  /**
   * Open the inline prompt over the current ProseMirror selection. No-op
   * if nothing is selected or if a generation is already in progress.
   */
  executeAIPromptSelection(): void {
    const view = this.getView();
    if (!view) return;
    const { from, to } = view.state.selection;
    if (from === to) return;

    const pluginState = aiInlineKey.getState(view.state);
    if (pluginState && pluginState.status !== 'idle') return;

    const selectionText = view.state.doc.textBetween(from, to, '\n');
    view.dispatch(
      view.state.tr.setMeta(aiInlineKey, {
        type: 'PROMPT_OPEN',
        from,
        to,
        selectionText,
      } as AIInlineMeta),
    );
  }

  /**
   * Open the inline prompt over an explicit range — used when the
   * caller already knows the coordinates (e.g. after a mouse-driven
   * selection).
   */
  executeAIPromptSelectionAt(from: number, to: number, selectionText: string): void {
    const view = this.getView();
    if (!view || from === to) return;

    const pluginState = aiInlineKey.getState(view.state);
    if (pluginState && pluginState.status !== 'idle') return;

    view.dispatch(
      view.state.tr.setMeta(aiInlineKey, {
        type: 'PROMPT_OPEN',
        from,
        to,
        selectionText,
      } as AIInlineMeta),
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Generation start
  // ─────────────────────────────────────────────────────────────────

  /**
   * Lock the current visible block and kick off an async generate. The
   * host AI callback returns markdown via `onComplete`; we stream it into
   * the AI block overlay and apply it in one document transaction.
   */
  executeAIInlineGenerate(prompt: string): void {
    const view = this.getView();
    if (!view) return;

    const target = this.resolveBlockAt(view, view.state.selection.from);
    if (!target) return;

    this.startBlockAI(view, target.blockId, 'AI generate');
    this.scrollBlockIntoView(view, target.blockId);

    this.onGenerate?.(prompt, null, {
      onComplete: (markdown) => {
        const v = this.getView();
        if (!v) return;
        this.finishBlockAI(v, target.blockId, markdown);
      },
      onError: (msg) => {
        const v = this.getView();
        if (!v) return;
        this.failBlockAI(v, target.blockId, msg);
      },
    });
  }

  /**
   * Submit a prompt against an existing selection. Unlike
   * `executeAIInlineGenerate`, the original text stays visible while the
   * block lock prevents conflicting edits to the affected visible block.
   */
  handleAIInlinePromptSubmit(
    prompt: string,
    selectionText: string,
    from: number,
    to: number,
  ): void {
    const view = this.getView();
    if (!view) return;

    const target = this.resolveBlockAt(view, from);
    if (!target) return;

    const originalContent = selectionText;
    startAIInlineProcessing(view, prompt, from, to, originalContent);
    this.startBlockAI(view, target.blockId, 'AI rewrite');
    this.scrollBlockIntoView(view, target.blockId);

    this.onGenerate?.(prompt, selectionText, {
      onComplete: (markdown) => {
        const v = this.getView();
        if (!v) return;
        this.finishBlockAI(v, target.blockId, markdown);
        v.dispatch(
          v.state.tr.setMeta(aiInlineKey, { type: 'ACCEPT' } satisfies AIInlineMeta)
        );
      },
      onError: (msg) => {
        const v = this.getView();
        if (!v) return;
        reportAIInlineError(v, msg);
        this.failBlockAI(v, target.blockId, msg);
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Accept / Retry / Deny
  // ─────────────────────────────────────────────────────────────────

  /**
   * Commit the AI-generated text. Selection mode replaces the exact
   * range with inline text; generate mode replaces with parsed blocks.
   */
  handleAIInlineAccept(data: {
    blockFrom: number;
    blockTo: number;
    markdown: string;
    mode: AIInlineMode;
  }): void {
    const view = this.getView();
    if (!view) return;

    if (data.mode === 'selection') {
      const resultText = data.markdown.trim();
      const textNode = view.state.schema.text(resultText);
      const tr = view.state.tr.replaceWith(data.blockFrom, data.blockTo, textNode);
      view.dispatch(tr);
      return;
    }

    const pmDoc = parseMarkdown(data.markdown);
    const tr = view.state.tr.replaceWith(data.blockFrom, data.blockTo, pmDoc.content);
    view.dispatch(tr);
  }

  /**
   * Re-run the same prompt. Reads the active selection text from the
   * inline plugin (only present in selection mode) so we don't re-open
   * the prompt UI.
   */
  handleAIInlineRetry(prompt: string): void {
    const view = this.getView();
    if (!view) return;

    const pluginState = aiInlineKey.getState(view.state);
    const selectionText =
      pluginState?.mode === 'selection' ? pluginState.selectionText : null;

    this.onGenerate?.(prompt, selectionText, {
      onComplete: (markdown) => {
        const v = this.getView();
        if (!v) return;
        const html = renderMarkdownToHtml(markdown);
        showAIInlinePreview(v, markdown, html);
      },
      onError: (msg) => {
        const v = this.getView();
        if (v) reportAIInlineError(v, msg);
      },
    });
  }

  /** Reject the AI output and restore the original markdown content. */
  handleAIInlineDeny(data: {
    blockFrom: number;
    blockTo: number;
    originalContent: string;
  }): void {
    const view = this.getView();
    if (!view) return;

    const pmDoc = parseMarkdown(data.originalContent);
    const tr = view.state.tr.replaceWith(data.blockFrom, data.blockTo, pmDoc.content);
    view.dispatch(tr);
  }

  private resolveBlockAt(
    view: EditorView,
    pos: number,
  ): { blockId: string; pos: number; end: number; node: PmNode } | null {
    const resolved = resolveVisibleBlock(view.state.doc.resolve(pos));
    const blockId = resolved?.node.attrs.id as string | undefined;
    if (!resolved || !blockId) return null;
    return { blockId, pos: resolved.pos, end: resolved.end, node: resolved.node };
  }

  private startBlockAI(view: EditorView, blockId: string, operation: string): void {
    let originalContent = '';
    view.state.doc.descendants((node) => {
      if (node.attrs?.id === blockId) {
        originalContent = node.textContent;
        return false;
      }
      return true;
    });

    view.dispatch(
      view.state.tr.setMeta(aiBlockKey, {
        type: 'LOCK',
        blockId,
        operation,
        originalContent,
        abortId: `ai-${blockId}-${Date.now()}`,
      } satisfies AIBlockMeta)
    );
    this.onActiveTarget?.(blockId);
  }

  private finishBlockAI(view: EditorView, blockId: string, markdown: string): void {
    this.streamBlockAI(view, blockId, markdown);
    view.dispatch(
      view.state.tr.setMeta(aiBlockKey, { type: 'APPLYING', blockId } satisfies AIBlockMeta)
    );
    this.replaceBlockContent(view, blockId, markdown);
    view.dispatch(
      view.state.tr.setMeta(aiBlockKey, { type: 'COMPLETE', blockId } satisfies AIBlockMeta)
    );
    this.onActiveTarget?.(blockId);

    setTimeout(() => {
      const currentView = this.getView();
      if (!currentView) return;
      const locks = aiBlockKey.getState(currentView.state);
      if (!locks?.has(blockId) || locks.get(blockId)?.phase !== 'complete') return;
      currentView.dispatch(
        currentView.state.tr.setMeta(aiBlockKey, { type: 'ACCEPT', blockId } satisfies AIBlockMeta)
      );
      this.onActiveTarget?.(null);
    }, 900);
  }

  private streamBlockAI(view: EditorView, blockId: string, markdown: string): void {
    view.dispatch(
      view.state.tr.setMeta(aiBlockKey, {
        type: 'STREAM_CHUNK',
        blockId,
        text: markdown,
      } satisfies AIBlockMeta)
    );
  }

  private failBlockAI(view: EditorView, blockId: string, message: string): void {
    view.dispatch(
      view.state.tr.setMeta(aiBlockKey, {
        type: 'ERROR',
        blockId,
        message,
      } satisfies AIBlockMeta)
    );
    this.onActiveTarget?.(blockId);
  }

  private scrollBlockIntoView(view: EditorView, blockId: string): void {
    const blockEl = view.dom.querySelector(
      `[data-block-id="${blockId}"]`
    ) as HTMLElement | null;
    blockEl?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  private replaceBlockContent(view: EditorView, blockId: string, markdown: string): void {
    let targetPos = -1;
    let targetNode: PmNode | null = null;

    view.state.doc.descendants((node, pos) => {
      if (targetNode) return false;
      if (node.attrs?.id === blockId) {
        targetNode = node;
        targetPos = pos;
        return false;
      }
      return true;
    });

    if (!targetNode || targetPos < 0) return;

    const pmDoc = parseMarkdown(markdown);
    if (!pmDoc.content.childCount) return;

    const node = targetNode as PmNode;
    if (node.isTextblock) {
      const innerStart = targetPos + 1;
      const innerEnd = targetPos + node.nodeSize - 1;
      const firstChild = pmDoc.content.firstChild;
      const newContent = firstChild?.isTextblock ? firstChild.content : pmDoc.content;
      view.dispatch(
        view.state.tr
          .replaceWith(innerStart, innerEnd, newContent)
          .setMeta(AI_BYPASS, true)
      );
      return;
    }

    view.dispatch(
      view.state.tr
        .replaceWith(targetPos, targetPos + node.nodeSize, pmDoc.content)
        .setMeta(AI_BYPASS, true)
    );
  }
}
