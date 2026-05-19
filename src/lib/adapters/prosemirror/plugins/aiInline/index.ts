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
  type AIInlinePluginOptions,
} from './plugin';
