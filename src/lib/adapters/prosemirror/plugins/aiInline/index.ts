/**
 * AI Inline Plugin barrel export
 *
 * ProseMirror plugin for inline AI content generation.
 */

// State
export {
  aiInlineKey,
  INITIAL_STATE as aiInlineInitialState,
  type AIInlineState,
  type AIInlineMeta,
  type AIInlineStatus,
  type AIInlineMode,
  type InlineAIComposer,
  type InlineAIComposerStatus,
} from './state';

// Decorations
export { createAIInlineDecorations } from './decorations';

// Plugin
export {
  createAIInlinePlugin,
  startAIInlineProcessing,
  showAIInlinePreview,
  acceptAIInlineResult,
  retryAIInline,
  denyAIInline,
  reportAIInlineError,
  cancelAIInlineProcessing,
  updateAIInlineComposerDraft,
  submitAIInlineComposer,
  cancelAIInlineComposer,
  focusAIInlineComposer,
  type AIInlinePluginOptions,
} from './plugin';
