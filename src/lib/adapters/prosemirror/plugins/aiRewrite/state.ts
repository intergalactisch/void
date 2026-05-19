/**
 * AI Rewrite Plugin State
 *
 * Defines the state structure for the AI rewrite ProseMirror plugin.
 * Tracks processing status, selection range, and result text.
 */

import { PluginKey } from 'prosemirror-state';
import type { AIOperation } from '$lib/ports/outbound';

/**
 * State for the AI rewrite plugin.
 */
export interface AIRewritePluginState {
  /** Whether AI is currently processing */
  isProcessing: boolean;
  /** The operation being performed */
  operation: AIOperation | null;
  /** Range being processed (document positions) */
  range: {
    /** Start position */
    from: number;
    /** End position */
    to: number;
  } | null;
  /** Original text before AI processing (for undo/reject) */
  originalText: string | null;
  /** Result text from AI (built up during streaming) */
  resultText: string;
  /** Whether to show the AI result popup */
  showPopup: boolean;
  /** Popup coordinates for positioning */
  popupCoords: {
    /** Top position in pixels */
    top: number;
    /** Left position in pixels */
    left: number;
  } | null;
  /** Error message if operation failed */
  error: string | null;
}

/**
 * Initial state for the AI rewrite plugin.
 */
export const INITIAL_STATE: AIRewritePluginState = {
  isProcessing: false,
  operation: null,
  range: null,
  originalText: null,
  resultText: '',
  showPopup: false,
  popupCoords: null,
  error: null,
};

/**
 * Plugin key for accessing AI rewrite state.
 */
export const aiRewriteKey = new PluginKey<AIRewritePluginState>('aiRewrite');

/**
 * Get AI rewrite state from editor state.
 *
 * @param state - ProseMirror editor state
 * @returns The current AI rewrite plugin state
 */
export function getAIRewriteState(state: { plugin: (key: PluginKey<AIRewritePluginState>) => AIRewritePluginState | undefined }): AIRewritePluginState {
  return state.plugin(aiRewriteKey) || INITIAL_STATE;
}

/**
 * Meta action types for state transitions.
 */
export type AIRewriteMeta =
  | { type: 'START'; operation: AIOperation; from: number; to: number; text: string; coords: { top: number; left: number } }
  | { type: 'UPDATE_RESULT'; text: string }
  | { type: 'COMPLETE'; text: string }
  | { type: 'ERROR'; message: string }
  | { type: 'SHOW_POPUP'; coords: { top: number; left: number } }
  | { type: 'HIDE_POPUP' }
  | { type: 'ACCEPT' }
  | { type: 'REJECT' }
  | { type: 'CANCEL' }
  | { type: 'RESET' };

/**
 * Check if a selection is valid for AI operations.
 *
 * @param from - Start position
 * @param to - End position
 * @returns True if the selection is valid (non-empty)
 */
export function isValidSelection(from: number, to: number): boolean {
  return from !== to && from >= 0 && to >= 0;
}

/**
 * Get operation label for display.
 *
 * @param operation - The AI operation
 * @returns Human-readable label
 */
export function getOperationLabel(operation: AIOperation | null): string {
  switch (operation) {
    case 'rewrite':
      return 'Rewriting';
    case 'expand':
      return 'Expanding';
    case 'summarize':
      return 'Summarizing';
    case 'fix-grammar':
      return 'Fixing grammar';
    case 'translate':
      return 'Translating';
    case 'custom':
      return 'Processing';
    default:
      return 'Processing';
  }
}
