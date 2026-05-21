/**
 * AI Inline Plugin State
 *
 * Defines the state machine for inline AI content generation.
 * Tracks processing status, prompt, result, and block position.
 */

import { PluginKey } from 'prosemirror-state';

/**
 * Possible states for the AI inline generation flow.
 */
export type AIInlineStatus = 'idle' | 'prompting' | 'processing' | 'preview' | 'error';

/**
 * Operation mode: 'generate' creates new content, 'selection' rewrites selected text.
 */
export type AIInlineMode = 'generate' | 'selection';

/**
 * State for the AI inline plugin.
 */
export interface AIInlineState {
  /** Current status in the generation flow */
  status: AIInlineStatus;
  /** Operation mode */
  mode: AIInlineMode;
  /** Position boundaries of the target block(s) */
  blockPos: { from: number; to: number } | null;
  /** The user's prompt text */
  prompt: string;
  /** Raw markdown response from AI */
  resultMarkdown: string;
  /** Rendered HTML for preview display */
  resultHtml: string;
  /** Error message if generation failed */
  error: string | null;
  /** Original text content for restore on deny (selection mode only) */
  originalContent: string;
  /** Selected text sent to AI as context (selection mode only) */
  selectionText: string;
  /** Whether the original document text was replaced with a placeholder */
  textReplaced: boolean;
  /** Whether the final inline AI result applied editor changes. */
  didMutate: boolean;
  /** Number of tool calls the final inline AI result used. */
  toolCount: number;
  /** Conversation containing the persisted inline AI turn. */
  conversationId: string | null;
}

/**
 * Initial state for the AI inline plugin.
 */
export const INITIAL_STATE: AIInlineState = {
  status: 'idle',
  mode: 'generate',
  blockPos: null,
  prompt: '',
  resultMarkdown: '',
  resultHtml: '',
  error: null,
  originalContent: '',
  selectionText: '',
  textReplaced: false,
  didMutate: false,
  toolCount: 0,
  conversationId: null,
};

/**
 * Plugin key for accessing AI inline state.
 */
export const aiInlineKey = new PluginKey<AIInlineState>('aiInline');

/**
 * Meta action types for state transitions.
 */
export type AIInlineMeta =
  | { type: 'START'; prompt: string; from: number; to: number; originalContent?: string }
  | { type: 'PROMPT_OPEN'; from: number; to: number; selectionText: string }
  | { type: 'PROMPT_SUBMIT'; prompt: string }
  | { type: 'PROMPT_CANCEL' }
  | {
      type: 'PREVIEW';
      resultMarkdown: string;
      resultHtml: string;
      from?: number;
      to?: number;
      didMutate?: boolean;
      toolCount?: number;
      conversationId?: string;
    }
  | { type: 'ACCEPT' }
  | { type: 'RETRY' }
  | { type: 'DENY' }
  | { type: 'ERROR'; message: string }
  | { type: 'CANCEL' };
