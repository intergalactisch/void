/**
 * AI Rewrite Plugin barrel export
 *
 * ProseMirror plugin for AI-powered text rewriting.
 */

// State
export {
  aiRewriteKey,
  INITIAL_STATE as aiRewriteInitialState,
  getAIRewriteState,
  getOperationLabel,
  isValidSelection,
  type AIRewritePluginState,
  type AIRewriteMeta,
} from './state';

// Decorations
export {
  createAIDecorations,
  aiDecorationStyles,
  AI_PROCESSING_RANGE_CLASS,
  AI_PROCESSING_INDICATOR_CLASS,
  AI_SPINNER_CLASS,
  AI_LABEL_CLASS,
  AI_RESULT_CLASS,
  AI_ERROR_CLASS,
} from './decorations';

// Plugin
export {
  createAIRewritePlugin,
  startAIProcessing,
  updateAIResult,
  completeAIProcessing,
  reportAIError,
  acceptAIResult,
  rejectAIResult,
  cancelAIProcessing,
  showAIPopup,
  hideAIPopup,
  resetAIProcessing,
  type AIRewritePluginOptions,
} from './plugin';
