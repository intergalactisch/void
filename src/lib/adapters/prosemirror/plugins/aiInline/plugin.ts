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

import { Plugin } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import {
  aiInlineKey,
  INITIAL_STATE,
  type AIInlineState,
  type AIInlineMeta,
  type AIInlineMode,
} from './state';
import { createAIInlineDecorations } from './decorations';

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
  /** Callback when user submits a prompt from Cmd+J prompt input */
  onPromptSubmit?: (prompt: string, selectionText: string, selectionFrom: number, selectionTo: number) => void;
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

          // Handle prompt submit — start selection AI flow
          if (meta.type === 'PROMPT_SUBMIT' && state.status === 'prompting' && state.blockPos) {
            setTimeout(() => {
              options.onPromptSubmit?.(
                meta.prompt,
                state.selectionText,
                state.blockPos!.from,
                state.blockPos!.to,
              );
            }, 0);
          }

          if (options.onStateChange && newState !== state) {
            setTimeout(() => options.onStateChange!(newState), 0);
          }

          return newState;
        }

        // Map block positions through document changes
        if (state.blockPos && tr.docChanged) {
          const newFrom = tr.mapping.map(state.blockPos.from);
          const newTo = tr.mapping.map(state.blockPos.to);

          if (newFrom !== state.blockPos.from || newTo !== state.blockPos.to) {
            return {
              ...state,
              blockPos: { from: newFrom, to: newTo },
            };
          }
        }

        return state;
      },
    },

    props: {
      decorations: createAIInlineDecorations,

      handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
        const state = aiInlineKey.getState(view.state);
        const isMod = event.metaKey || event.ctrlKey;

        // Cmd+J with selection → open AI prompt input
        if (isMod && event.key === 'j') {
          const { from, to } = view.state.selection;
          if (from !== to && (!state || state.status === 'idle')) {
            event.preventDefault();
            const selectionText = view.state.doc.textBetween(from, to, '\n');
            view.dispatch(
              view.state.tr.setMeta(aiInlineKey, {
                type: 'PROMPT_OPEN',
                from,
                to,
                selectionText,
              } satisfies AIInlineMeta)
            );
            return true;
          }
        }

        if (!state || state.status === 'idle') return false;

        // Prompting state: only handle Escape to cancel
        // (all other input goes to the prompt input widget)
        if (state.status === 'prompting') {
          if (event.key === 'Escape') {
            event.preventDefault();
            view.dispatch(
              view.state.tr.setMeta(aiInlineKey, { type: 'PROMPT_CANCEL' } satisfies AIInlineMeta)
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

        // Only block editing keys when cursor is inside the AI placeholder block
        if (state.status === 'processing' || state.status === 'preview') {
          if (state.blockPos && isCursorInsideBlock(view, state.blockPos)) {
            if (isEditingKey(event)) {
              event.preventDefault();
              return true;
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
        ...INITIAL_STATE,
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
      return {
        ...INITIAL_STATE,
        status: 'prompting',
        mode: 'selection',
        blockPos: { from: meta.from, to: meta.to },
        selectionText: meta.selectionText,
      };

    case 'PROMPT_SUBMIT':
      return {
        ...state,
        prompt: meta.prompt,
      };

    case 'PROMPT_CANCEL':
      return INITIAL_STATE;

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
      return INITIAL_STATE;

    case 'DENY':
    case 'CANCEL':
      return INITIAL_STATE;

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

/**
 * Check if a key event is an editing key that should be blocked.
 */
function isEditingKey(event: KeyboardEvent): boolean {
  const allowedKeys = [
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown',
    'Tab', 'Escape',
    'Control', 'Alt', 'Meta', 'Shift',
  ];

  if (allowedKeys.includes(event.key)) return false;
  if (event.metaKey || event.ctrlKey) return false;

  return true;
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
