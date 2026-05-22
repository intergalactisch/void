/**
 * AI Inline Plugin
 *
 * ProseMirror plugin that manages inline AI content generation.
 * Handles state transitions, decorations, and keyboard shortcuts.
 *
 * Supports two modes:
 * - 'generate': Creates new content from a /ai prompt (replaces immediately with placeholder)
 * - 'selection': Rewrites selected text via Cmd+J (keeps original visible during loading)
 */

import { Plugin, TextSelection } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import {
  aiInlineKey,
  INITIAL_STATE,
  type AIInlineState,
  type AIInlineMeta,
  type AIInlineMode,
  type InlineAIComposer,
} from './state';
import { createAIInlineDecorations } from './decorations';
import {
  insertAIContinuation,
  resolveAIContinuationTargetForRange,
  shouldActivateAIContinuationFromKey,
} from '../aiContinuation';

/**
 * Configuration options for the AI inline plugin.
 */
export interface AIInlinePluginOptions {
  /** Callback when state changes (for syncing with external code) */
  onStateChange?: ((state: AIInlineState) => void) | undefined;
  /** Callback when user accepts the result */
  onAccept?: (data: { blockFrom: number; blockTo: number; markdown: string; mode: AIInlineMode }) => void;
  /** Callback when user retries */
  onRetry?: (prompt: string) => void;
  /** Callback when user denies and original text needs restoring (selection mode) */
  onDeny?: (data: { blockFrom: number; blockTo: number; originalContent: string }) => void;
  /** Callback when user submits a prompt from a floating selection composer */
  onPromptSubmit?: (data: {
    composerId: string;
    prompt: string;
    selectionText: string;
    selectionFrom: number;
    selectionTo: number;
  }) => void;
}

/**
 * Create the AI inline plugin.
 */
export function createAIInlinePlugin(options: AIInlinePluginOptions = {}): Plugin {
  return new Plugin<AIInlineState>({
    key: aiInlineKey,

    state: {
      init: () => INITIAL_STATE,

      apply(tr: Transaction, state: AIInlineState): AIInlineState {
        const meta = tr.getMeta(aiInlineKey) as AIInlineMeta | undefined;

        if (meta) {
          const submittedComposer = getSubmittedComposer(state, meta);
          const newState = applyMeta(state, meta);

          // Handle side effects for ACCEPT and RETRY
          if (meta.type === 'ACCEPT' && state.status === 'preview' && state.blockPos) {
            setTimeout(() => {
              options.onAccept?.({
                blockFrom: state.blockPos!.from,
                blockTo: state.blockPos!.to,
                markdown: state.resultMarkdown,
                mode: state.mode,
              });
            }, 0);
          }

          if (meta.type === 'RETRY' && state.prompt) {
            setTimeout(() => {
              options.onRetry?.(state.prompt);
            }, 0);
          }

          // Restore original text on deny/cancel only if text was actually replaced
          if (
            (meta.type === 'DENY' || meta.type === 'CANCEL') &&
            state.mode === 'selection' &&
            state.textReplaced &&
            state.blockPos &&
            state.originalContent
          ) {
            setTimeout(() => {
              options.onDeny?.({
                blockFrom: state.blockPos!.from,
                blockTo: state.blockPos!.to,
                originalContent: state.originalContent,
              });
            }, 0);
          }

          // Handle composer submit — start selection AI flow for this anchor only.
          if (submittedComposer && (meta.type === 'COMPOSER_SUBMIT' || meta.type === 'PROMPT_SUBMIT')) {
            setTimeout(() => {
              options.onPromptSubmit?.({
                composerId: submittedComposer.id,
                prompt: meta.prompt,
                selectionText: submittedComposer.selectionText,
                selectionFrom: submittedComposer.from,
                selectionTo: submittedComposer.to,
              });
            }, 0);
          }

          if (options.onStateChange && newState !== state) {
            setTimeout(() => options.onStateChange!(newState), 0);
          }

          return newState;
        }

        // Map block positions and composer anchors through document changes.
        if (tr.docChanged) {
          const mappedComposers = state.composers.map((composer) => ({
            ...composer,
            from: tr.mapping.map(composer.from),
            to: tr.mapping.map(composer.to),
          }));

          const composersChanged = mappedComposers.some((composer, index) => {
            const previous = state.composers[index];
            return !previous || composer.from !== previous.from || composer.to !== previous.to;
          });

          if (!state.blockPos) {
            if (!composersChanged) return state;
            const nextState = { ...state, composers: mappedComposers };
            if (options.onStateChange) {
              setTimeout(() => options.onStateChange!(nextState), 0);
            }
            return nextState;
          }

          const newFrom = tr.mapping.map(state.blockPos.from);
          const newTo = tr.mapping.map(state.blockPos.to);

          if (newFrom !== state.blockPos.from || newTo !== state.blockPos.to || composersChanged) {
            const nextState = {
              ...state,
              blockPos: { from: newFrom, to: newTo },
              composers: mappedComposers,
            };
            if (options.onStateChange) {
              setTimeout(() => options.onStateChange!(nextState), 0);
            }
            return nextState;
          }
        }

        return state;
      },
    },

    filterTransaction(tr: Transaction, state): boolean {
      if (!tr.docChanged) return true;

      const pluginState = aiInlineKey.getState(state);
      if (!isProtectedInlineState(pluginState)) return true;

      return !transactionTouchesRange(tr, pluginState.blockPos.from, pluginState.blockPos.to);
    },

    props: {
      decorations: createAIInlineDecorations,

      handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
        const state = aiInlineKey.getState(view.state);
        const isMod = event.metaKey || event.ctrlKey;

        // Cmd+J with selection → open AI prompt input
        if (isMod && event.key === 'j') {
          const { from, to } = view.state.selection;
          if (from !== to) {
            event.preventDefault();
            const selectionText = view.state.doc.textBetween(from, to, '\n');
            view.dispatch(
              view.state.tr
                .setSelection(TextSelection.create(view.state.doc, to))
                .setMeta(aiInlineKey, {
                  type: 'COMPOSER_OPEN',
                  from,
                  to,
                  selectionText,
                } satisfies AIInlineMeta)
            );
            return true;
          }
        }

        if (state?.activeComposerId && event.key === 'Escape') {
          event.preventDefault();
          view.dispatch(
            view.state.tr.setMeta(aiInlineKey, {
              type: 'COMPOSER_CANCEL',
              id: state.activeComposerId,
            } satisfies AIInlineMeta)
          );
          return true;
        }

        if (!state || state.status === 'idle') return false;

        // Prompting state: only handle Escape to cancel
        // (all other input goes to the prompt input widget)
        if (state.status === 'prompting') {
          if (event.key === 'Escape') {
            event.preventDefault();
            const meta: AIInlineMeta = state.activeComposerId
              ? { type: 'PROMPT_CANCEL', composerId: state.activeComposerId }
              : { type: 'PROMPT_CANCEL' };
            view.dispatch(
              view.state.tr.setMeta(aiInlineKey, meta)
            );
            return true;
          }
          return false;
        }

        // Preview state keyboard shortcuts (work anywhere in the document)
        if (state.status === 'preview') {
          // Cmd+R → Retry
          if (isMod && event.key === 'r') {
            event.preventDefault();
            view.dispatch(
              view.state.tr.setMeta(aiInlineKey, { type: 'RETRY' } satisfies AIInlineMeta)
            );
            return true;
          }

          // Escape → Deny
          if (event.key === 'Escape') {
            event.preventDefault();
            view.dispatch(
              view.state.tr.setMeta(aiInlineKey, { type: 'DENY' } satisfies AIInlineMeta)
            );
            return true;
          }
        }

        // Processing state: Escape → Cancel
        if (state.status === 'processing' && event.key === 'Escape') {
          event.preventDefault();
          view.dispatch(
            view.state.tr.setMeta(aiInlineKey, { type: 'CANCEL' } satisfies AIInlineMeta)
          );
          return true;
        }

        // Error state: Escape → Dismiss
        if (state.status === 'error' && event.key === 'Escape') {
          event.preventDefault();
          view.dispatch(
            view.state.tr.setMeta(aiInlineKey, { type: 'DENY' } satisfies AIInlineMeta)
          );
          return true;
        }

        // Keep navigation free. Only intercept ArrowDown when it can express
        // "continue below"; document edits are protected by filterTransaction.
        if (state.status === 'processing' || state.status === 'preview') {
          if (state.blockPos && isCursorInsideBlock(view, state.blockPos)) {
            if (shouldActivateAIContinuationFromKey(view, event)) {
              const target = resolveAIContinuationTargetForRange(
                view.state,
                state.blockPos.from,
                state.blockPos.to
              );
              if (target && insertAIContinuation(view, target)) {
                event.preventDefault();
                return true;
              }
            }
          }
        }

        return false;
      },
    },
  });
}

/**
 * Apply a meta action to the state.
 */
function applyMeta(state: AIInlineState, meta: AIInlineMeta): AIInlineState {
  switch (meta.type) {
    case 'START':
      return {
        ...resetLegacyState(state),
        status: 'processing',
        mode: state.mode,
        prompt: meta.prompt,
        blockPos: { from: meta.from, to: meta.to },
        originalContent: meta.originalContent ?? state.originalContent,
        selectionText: state.selectionText,
        // generate mode replaces text immediately, selection mode keeps it
        textReplaced: state.mode === 'generate',
      };

    case 'PROMPT_OPEN':
      return addComposer(state, meta.from, meta.to, meta.selectionText);

    case 'PROMPT_SUBMIT':
      return submitComposer(state, meta.composerId ?? state.activeComposerId, meta.prompt);

    case 'PROMPT_CANCEL':
      return meta.composerId || state.activeComposerId
        ? cancelComposer(state, meta.composerId ?? state.activeComposerId)
        : resetLegacyState(state);

    case 'COMPOSER_OPEN':
      return addComposer(state, meta.from, meta.to, meta.selectionText, '', meta.id);

    case 'COMPOSER_UPDATE_DRAFT':
      return updateComposerDraft(state, meta.id, meta.prompt);

    case 'COMPOSER_SUBMIT':
      return submitComposer(state, meta.id, meta.prompt);

    case 'COMPOSER_CANCEL':
      return cancelComposer(state, meta.id);

    case 'COMPOSER_FOCUS':
      return state.composers.some((composer) => composer.id === meta.id)
        ? { ...state, activeComposerId: meta.id }
        : state;

    case 'PREVIEW':
      return {
        ...state,
        status: 'preview',
        resultMarkdown: meta.resultMarkdown,
        resultHtml: meta.resultHtml,
        // Update blockPos if replacement happened (selection mode)
        blockPos: meta.from != null && meta.to != null
          ? { from: meta.from, to: meta.to }
          : state.blockPos,
        // Only mark as replaced if the adapter actually replaced the text
        textReplaced: (meta.from != null && meta.to != null) ? true : state.textReplaced,
        didMutate: meta.didMutate ?? state.didMutate,
        toolCount: meta.toolCount ?? state.toolCount,
        conversationId: meta.conversationId ?? state.conversationId,
      };

    case 'ACCEPT':
      return resetLegacyState(state);

    case 'DENY':
    case 'CANCEL':
      return resetLegacyState(state);

    case 'RETRY':
      return {
        ...state,
        status: 'processing',
        resultMarkdown: '',
        resultHtml: '',
        error: null,
        didMutate: false,
        toolCount: 0,
        conversationId: null,
        // textReplaced stays true if it was already true (after preview)
      };

    case 'ERROR':
      return {
        ...state,
        status: 'error',
        error: meta.message,
      };

    default:
      return state;
  }
}

function resetLegacyState(state: AIInlineState): AIInlineState {
  return {
    ...INITIAL_STATE,
    composers: state.composers,
    activeComposerId: state.activeComposerId,
  };
}

function addComposer(
  state: AIInlineState,
  from: number,
  to: number,
  selectionText: string,
  draftPrompt = '',
  id = createComposerId(),
): AIInlineState {
  const now = new Date().toISOString();
  const composer: InlineAIComposer = {
    id,
    from,
    to,
    selectionText,
    draftPrompt,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };

  return {
    ...state,
    status: state.status === 'prompting' ? 'idle' : state.status,
    mode: 'selection',
    blockPos: state.status === 'prompting' ? null : state.blockPos,
    selectionText,
    composers: [...state.composers, composer],
    activeComposerId: id,
  };
}

function updateComposerDraft(state: AIInlineState, id: string, prompt: string): AIInlineState {
  let changed = false;
  const now = new Date().toISOString();
  const composers = state.composers.map((composer) => {
    if (composer.id !== id) return composer;
    changed = true;
    return { ...composer, draftPrompt: prompt, updatedAt: now };
  });
  return changed ? { ...state, composers } : state;
}

function submitComposer(
  state: AIInlineState,
  id: string | null | undefined,
  prompt: string,
): AIInlineState {
  if (!id) return state;
  let found = false;
  const composers = state.composers
    .map((composer) => {
      if (composer.id !== id) return composer;
      found = true;
      return {
        ...composer,
        draftPrompt: prompt,
        status: 'submitting' as const,
        updatedAt: new Date().toISOString(),
      };
    })
    .filter((composer) => composer.id !== id);

  if (!found) return state;
  return {
    ...state,
    composers,
    activeComposerId: state.activeComposerId === id ? composers.at(-1)?.id ?? null : state.activeComposerId,
  };
}

function cancelComposer(state: AIInlineState, id: string | null | undefined): AIInlineState {
  if (!id) return state;
  const composers = state.composers.filter((composer) => composer.id !== id);
  if (composers.length === state.composers.length) return state;
  return {
    ...state,
    composers,
    activeComposerId: state.activeComposerId === id ? composers.at(-1)?.id ?? null : state.activeComposerId,
  };
}

function getSubmittedComposer(
  state: AIInlineState,
  meta: AIInlineMeta,
): InlineAIComposer | null {
  const composerId =
    meta.type === 'COMPOSER_SUBMIT'
      ? meta.id
      : meta.type === 'PROMPT_SUBMIT'
        ? meta.composerId ?? state.activeComposerId
        : null;
  if (!composerId) return null;
  return state.composers.find((composer) => composer.id === composerId) ?? null;
}

function createComposerId(): string {
  return `inline-ai-composer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Check if the cursor (selection head) is inside the given block range.
 */
function isCursorInsideBlock(
  view: EditorView,
  blockPos: { from: number; to: number }
): boolean {
  const { from, to } = view.state.selection;
  return from >= blockPos.from && to <= blockPos.to;
}

function isProtectedInlineState(
  state: AIInlineState | undefined
): state is AIInlineState & { blockPos: { from: number; to: number } } {
  return Boolean(
    state?.blockPos &&
    (state.status === 'processing' || state.status === 'preview' || state.status === 'error')
  );
}

function transactionTouchesRange(tr: Transaction, from: number, to: number): boolean {
  let touches = false;

  tr.mapping.maps.forEach((stepMap) => {
    if (touches) return;
    stepMap.forEach((oldStart, oldEnd) => {
      if (touches) return;

      if (oldStart === oldEnd) {
        touches = oldStart > from && oldStart < to;
        return;
      }

      touches = oldStart < to && oldEnd > from;
    });
  });

  return touches;
}

// =========================================================================
// Helper functions for external use
// =========================================================================

/**
 * Start AI inline processing.
 */
export function startAIInlineProcessing(
  view: EditorView,
  prompt: string,
  blockFrom: number,
  blockTo: number,
  originalContent?: string
): void {
  const meta: AIInlineMeta = {
    type: 'START',
    prompt,
    from: blockFrom,
    to: blockTo,
  };
  if (originalContent) {
    meta.originalContent = originalContent;
  }
  view.dispatch(view.state.tr.setMeta(aiInlineKey, meta));
}

/**
 * Show AI inline preview with results.
 * Optional from/to for when the adapter replaces original text with a placeholder.
 */
export function showAIInlinePreview(
  view: EditorView,
  resultMarkdown: string,
  resultHtml: string,
  from?: number,
  to?: number,
  options?: { didMutate?: boolean; toolCount?: number; conversationId?: string | null }
): void {
  const meta: AIInlineMeta = {
    type: 'PREVIEW',
    resultMarkdown,
    resultHtml,
  };
  if (from != null && to != null) {
    meta.from = from;
    meta.to = to;
  }
  if (options?.didMutate !== undefined) {
    meta.didMutate = options.didMutate;
  }
  if (options?.toolCount !== undefined) {
    meta.toolCount = options.toolCount;
  }
  if (options?.conversationId) {
    meta.conversationId = options.conversationId;
  }
  view.dispatch(view.state.tr.setMeta(aiInlineKey, meta));
}

/**
 * Accept the AI inline result.
 * Returns data needed for content insertion, or null if not in preview.
 */
export function acceptAIInlineResult(
  view: EditorView
): { blockFrom: number; blockTo: number; markdown: string } | null {
  const state = aiInlineKey.getState(view.state);
  if (!state || state.status !== 'preview' || !state.blockPos) return null;

  const data = {
    blockFrom: state.blockPos.from,
    blockTo: state.blockPos.to,
    markdown: state.resultMarkdown,
  };

  view.dispatch(
    view.state.tr.setMeta(aiInlineKey, { type: 'ACCEPT' } satisfies AIInlineMeta)
  );

  return data;
}

/**
 * Retry AI inline generation.
 * Returns the prompt to retry with, or null if not in preview/error.
 */
export function retryAIInline(view: EditorView): string | null {
  const state = aiInlineKey.getState(view.state);
  if (!state || (state.status !== 'preview' && state.status !== 'error')) return null;

  const prompt = state.prompt;
  view.dispatch(
    view.state.tr.setMeta(aiInlineKey, { type: 'RETRY' } satisfies AIInlineMeta)
  );
  return prompt;
}

/**
 * Deny/dismiss AI inline result.
 */
export function denyAIInline(view: EditorView): void {
  view.dispatch(
    view.state.tr.setMeta(aiInlineKey, { type: 'DENY' } satisfies AIInlineMeta)
  );
}

/**
 * Report an error during AI inline generation.
 */
export function reportAIInlineError(view: EditorView, message: string): void {
  view.dispatch(
    view.state.tr.setMeta(aiInlineKey, {
      type: 'ERROR',
      message,
    } satisfies AIInlineMeta)
  );
}

/**
 * Cancel ongoing AI inline processing.
 */
export function cancelAIInlineProcessing(view: EditorView): void {
  view.dispatch(
    view.state.tr.setMeta(aiInlineKey, { type: 'CANCEL' } satisfies AIInlineMeta)
  );
}

export function updateAIInlineComposerDraft(
  view: EditorView,
  id: string,
  prompt: string,
): void {
  view.dispatch(
    view.state.tr.setMeta(aiInlineKey, {
      type: 'COMPOSER_UPDATE_DRAFT',
      id,
      prompt,
    } satisfies AIInlineMeta)
  );
}

export function submitAIInlineComposer(
  view: EditorView,
  id: string,
  prompt: string,
): void {
  view.dispatch(
    view.state.tr.setMeta(aiInlineKey, {
      type: 'COMPOSER_SUBMIT',
      id,
      prompt,
    } satisfies AIInlineMeta)
  );
}

export function cancelAIInlineComposer(view: EditorView, id: string): void {
  view.dispatch(
    view.state.tr.setMeta(aiInlineKey, {
      type: 'COMPOSER_CANCEL',
      id,
    } satisfies AIInlineMeta)
  );
}

export function focusAIInlineComposer(view: EditorView, id: string): void {
  view.dispatch(
    view.state.tr.setMeta(aiInlineKey, {
      type: 'COMPOSER_FOCUS',
      id,
    } satisfies AIInlineMeta)
  );
}
