/**
 * AI Rewrite Plugin
 *
 * ProseMirror plugin that manages AI text rewriting functionality.
 * Combines state management and visual decorations.
 */

import { Plugin } from 'prosemirror-state';
import type { Transaction, EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import {
  aiRewriteKey,
  INITIAL_STATE,
  type AIRewritePluginState,
  type AIRewriteMeta,
} from './state';
import { createAIDecorations } from './decorations';
import type { AIOperation } from '$lib/ports/outbound';

/**
 * Configuration options for the AI rewrite plugin.
 */
export interface AIRewritePluginOptions {
  /** Callback when state changes (for syncing with Svelte) */
  onStateChange?: ((state: AIRewritePluginState) => void) | undefined;
}

/**
 * Create the AI rewrite plugin.
 *
 * @param options - Plugin configuration options
 * @returns ProseMirror Plugin
 */
export function createAIRewritePlugin(options: AIRewritePluginOptions = {}): Plugin {
  return new Plugin<AIRewritePluginState>({
    key: aiRewriteKey,

    state: {
      init: () => INITIAL_STATE,

      apply(tr: Transaction, state: AIRewritePluginState): AIRewritePluginState {
        const meta = tr.getMeta(aiRewriteKey) as AIRewriteMeta | undefined;

        if (meta) {
          const newState = applyMeta(state, meta);

          // Notify callback of state change
          if (options.onStateChange && newState !== state) {
            // Use setTimeout to avoid dispatching during apply
            setTimeout(() => options.onStateChange!(newState), 0);
          }

          return newState;
        }

        // Map range positions through document changes
        if (state.range && tr.docChanged) {
          const newFrom = tr.mapping.map(state.range.from);
          const newTo = tr.mapping.map(state.range.to);

          if (newFrom !== state.range.from || newTo !== state.range.to) {
            return {
              ...state,
              range: { from: newFrom, to: newTo },
            };
          }
        }

        return state;
      },
    },

    props: {
      decorations: createAIDecorations,

      handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
        const state = aiRewriteKey.getState(view.state);
        if (!state) return false;

        // Handle Escape to cancel during processing
        if (state.isProcessing && event.key === 'Escape') {
          event.preventDefault();
          cancelAIProcessing(view);
          return true;
        }

        // Block editing in processing range during processing
        if (state.isProcessing && state.range) {
          const { from, to } = view.state.selection;
          const inRange = (from >= state.range.from && from <= state.range.to) ||
                         (to >= state.range.from && to <= state.range.to);

          if (inRange && isEditingKey(event)) {
            event.preventDefault();
            return true;
          }
        }

        return false;
      },

      // Prevent clicks from disrupting processing
      handleClick(view: EditorView, _pos: number, event: Event): boolean {
        const state = aiRewriteKey.getState(view.state);
        if (state?.isProcessing) {
          event.preventDefault();
          return true;
        }
        return false;
      },
    },
  });
}

/**
 * Apply a meta action to the state.
 */
function applyMeta(state: AIRewritePluginState, meta: AIRewriteMeta): AIRewritePluginState {
  switch (meta.type) {
    case 'START':
      return {
        ...INITIAL_STATE,
        isProcessing: true,
        operation: meta.operation,
        range: { from: meta.from, to: meta.to },
        originalText: meta.text,
        popupCoords: meta.coords,
      };

    case 'UPDATE_RESULT':
      return {
        ...state,
        resultText: meta.text,
      };

    case 'COMPLETE':
      return {
        ...state,
        isProcessing: false,
        resultText: meta.text,
        showPopup: true,
      };

    case 'ERROR':
      return {
        ...state,
        isProcessing: false,
        error: meta.message,
      };

    case 'SHOW_POPUP':
      return {
        ...state,
        showPopup: true,
        popupCoords: meta.coords,
      };

    case 'HIDE_POPUP':
      return {
        ...state,
        showPopup: false,
      };

    case 'ACCEPT':
    case 'REJECT':
    case 'CANCEL':
    case 'RESET':
      return INITIAL_STATE;

    default:
      return state;
  }
}

/**
 * Check if a key event is an editing key.
 */
function isEditingKey(event: KeyboardEvent): boolean {
  // Allow navigation and control keys
  const allowedKeys = [
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown',
    'Tab', 'Escape',
    'Control', 'Alt', 'Meta', 'Shift',
  ];

  if (allowedKeys.includes(event.key)) {
    return false;
  }

  // Block all other keys (typing, deletion, etc.)
  return true;
}

// =========================================================================
// Helper functions for external use
// =========================================================================

/**
 * Start AI processing on the current selection.
 *
 * @param view - ProseMirror editor view
 * @param operation - The AI operation to perform
 */
export function startAIProcessing(
  view: EditorView,
  operation: AIOperation
): void {
  const { from, to } = view.state.selection;
  if (from === to) return; // No selection

  const text = view.state.doc.textBetween(from, to, '\n');
  const coords = view.coordsAtPos(from);

  view.dispatch(
    view.state.tr.setMeta(aiRewriteKey, {
      type: 'START',
      operation,
      from,
      to,
      text,
      coords: { top: coords.bottom + 8, left: coords.left },
    } satisfies AIRewriteMeta)
  );
}

/**
 * Update streaming result text.
 *
 * @param view - ProseMirror editor view
 * @param text - The current result text
 */
export function updateAIResult(view: EditorView, text: string): void {
  view.dispatch(
    view.state.tr.setMeta(aiRewriteKey, {
      type: 'UPDATE_RESULT',
      text,
    } satisfies AIRewriteMeta)
  );
}

/**
 * Complete AI processing with final result.
 *
 * @param view - ProseMirror editor view
 * @param text - The final result text
 */
export function completeAIProcessing(view: EditorView, text: string): void {
  view.dispatch(
    view.state.tr.setMeta(aiRewriteKey, {
      type: 'COMPLETE',
      text,
    } satisfies AIRewriteMeta)
  );
}

/**
 * Report an AI processing error.
 *
 * @param view - ProseMirror editor view
 * @param message - Error message
 */
export function reportAIError(view: EditorView, message: string): void {
  view.dispatch(
    view.state.tr.setMeta(aiRewriteKey, {
      type: 'ERROR',
      message,
    } satisfies AIRewriteMeta)
  );
}

/**
 * Accept the AI result and replace the original text.
 *
 * @param view - ProseMirror editor view
 */
export function acceptAIResult(view: EditorView): void {
  const state = aiRewriteKey.getState(view.state);
  if (!state?.range || !state.resultText) return;

  // Replace the text
  const tr = view.state.tr
    .replaceWith(
      state.range.from,
      state.range.to,
      view.state.schema.text(state.resultText)
    )
    .setMeta(aiRewriteKey, { type: 'ACCEPT' } satisfies AIRewriteMeta);

  view.dispatch(tr);
}

/**
 * Reject the AI result (keep original text).
 *
 * @param view - ProseMirror editor view
 */
export function rejectAIResult(view: EditorView): void {
  view.dispatch(
    view.state.tr.setMeta(aiRewriteKey, { type: 'REJECT' } satisfies AIRewriteMeta)
  );
}

/**
 * Cancel ongoing AI processing.
 *
 * @param view - ProseMirror editor view
 */
export function cancelAIProcessing(view: EditorView): void {
  view.dispatch(
    view.state.tr.setMeta(aiRewriteKey, { type: 'CANCEL' } satisfies AIRewriteMeta)
  );
}

/**
 * Show the AI result popup.
 *
 * @param view - ProseMirror editor view
 */
export function showAIPopup(view: EditorView): void {
  const { from } = view.state.selection;
  const coords = view.coordsAtPos(from);

  view.dispatch(
    view.state.tr.setMeta(aiRewriteKey, {
      type: 'SHOW_POPUP',
      coords: { top: coords.bottom + 8, left: coords.left },
    } satisfies AIRewriteMeta)
  );
}

/**
 * Hide the AI result popup.
 *
 * @param view - ProseMirror editor view
 */
export function hideAIPopup(view: EditorView): void {
  view.dispatch(
    view.state.tr.setMeta(aiRewriteKey, { type: 'HIDE_POPUP' } satisfies AIRewriteMeta)
  );
}

/**
 * Reset AI processing state.
 *
 * @param view - ProseMirror editor view
 */
export function resetAIProcessing(view: EditorView): void {
  view.dispatch(
    view.state.tr.setMeta(aiRewriteKey, { type: 'RESET' } satisfies AIRewriteMeta)
  );
}
