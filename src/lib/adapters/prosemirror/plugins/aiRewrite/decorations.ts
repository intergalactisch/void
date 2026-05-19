/**
 * AI Rewrite Decorations
 *
 * Creates ProseMirror decorations to visually indicate AI processing.
 * Shows processing indicator and highlights the selected text.
 */

import { DecorationSet, Decoration } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import { aiRewriteKey, type AIRewritePluginState, getOperationLabel } from './state';

/**
 * CSS class names for AI processing decorations.
 */
export const AI_PROCESSING_RANGE_CLASS = 'void-ai-processing-range';
export const AI_PROCESSING_INDICATOR_CLASS = 'void-ai-processing-indicator';
export const AI_SPINNER_CLASS = 'void-ai-spinner';
export const AI_LABEL_CLASS = 'void-ai-label';
export const AI_RESULT_CLASS = 'void-ai-result';
export const AI_ERROR_CLASS = 'void-ai-error';

/**
 * Create decorations for AI processing state.
 *
 * @param state - ProseMirror editor state
 * @returns DecorationSet with processing indicators
 */
export function createAIDecorations(state: EditorState): DecorationSet {
  const pluginState = aiRewriteKey.getState(state);

  if (!pluginState || !pluginState.range) {
    return DecorationSet.empty;
  }

  const { from, to } = pluginState.range;
  const decorations: Decoration[] = [];

  // Validate range is within document
  const docSize = state.doc.content.size;
  if (from < 0 || to > docSize || from >= to) {
    return DecorationSet.empty;
  }

  if (pluginState.isProcessing) {
    // Add processing range highlight
    decorations.push(
      Decoration.inline(from, to, {
        class: AI_PROCESSING_RANGE_CLASS,
        'data-operation': pluginState.operation || 'processing',
      })
    );

    // Add processing indicator widget at the start
    decorations.push(
      Decoration.widget(
        from,
        createProcessingIndicator(pluginState.operation),
        { side: -1, key: 'ai-processing-indicator' }
      )
    );
  } else if (pluginState.resultText && pluginState.showPopup) {
    // Add result highlight (different style from processing)
    decorations.push(
      Decoration.inline(from, to, {
        class: AI_RESULT_CLASS,
      })
    );
  } else if (pluginState.error) {
    // Add error highlight
    decorations.push(
      Decoration.inline(from, to, {
        class: AI_ERROR_CLASS,
      })
    );

    // Add error indicator widget
    decorations.push(
      Decoration.widget(
        from,
        createErrorIndicator(pluginState.error),
        { side: -1, key: 'ai-error-indicator' }
      )
    );
  }

  return DecorationSet.create(state.doc, decorations);
}

/**
 * Create the processing indicator DOM element.
 *
 * @param operation - The current AI operation
 * @returns HTMLElement for the indicator
 */
function createProcessingIndicator(operation: AIRewritePluginState['operation']): HTMLElement {
  const indicator = document.createElement('span');
  indicator.className = AI_PROCESSING_INDICATOR_CLASS;
  indicator.setAttribute('contenteditable', 'false');

  // Spinner
  const spinner = document.createElement('span');
  spinner.className = AI_SPINNER_CLASS;
  spinner.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
    </svg>
  `;

  // Label
  const label = document.createElement('span');
  label.className = AI_LABEL_CLASS;
  label.textContent = `${getOperationLabel(operation)}...`;

  indicator.appendChild(spinner);
  indicator.appendChild(label);

  return indicator;
}

/**
 * Create the error indicator DOM element.
 *
 * @param errorMessage - The error message to display
 * @returns HTMLElement for the indicator
 */
function createErrorIndicator(errorMessage: string): HTMLElement {
  const indicator = document.createElement('span');
  indicator.className = `${AI_PROCESSING_INDICATOR_CLASS} ${AI_ERROR_CLASS}`;
  indicator.setAttribute('contenteditable', 'false');

  // Error icon
  const icon = document.createElement('span');
  icon.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  `;

  // Error message
  const label = document.createElement('span');
  label.className = AI_LABEL_CLASS;
  label.textContent = errorMessage.length > 30
    ? `${errorMessage.slice(0, 30)}...`
    : errorMessage;

  indicator.appendChild(icon);
  indicator.appendChild(label);

  return indicator;
}

/**
 * CSS styles for AI processing decorations.
 * Should be included in the editor's stylesheet.
 */
export const aiDecorationStyles = `
/* AI Processing Range */
.${AI_PROCESSING_RANGE_CLASS} {
  background-color: rgba(147, 112, 219, 0.2);
  border-bottom: 2px dashed rgba(147, 112, 219, 0.5);
  transition: background-color 0.2s ease;
}

/* AI Processing Indicator */
.${AI_PROCESSING_INDICATOR_CLASS} {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  margin-right: 4px;
  font-size: 12px;
  font-weight: 500;
  color: #9370db;
  background-color: rgba(147, 112, 219, 0.1);
  border-radius: 4px;
  vertical-align: baseline;
  user-select: none;
}

/* Spinner Animation */
.${AI_SPINNER_CLASS} {
  display: inline-flex;
  animation: ai-spin 1s linear infinite;
}

.${AI_SPINNER_CLASS} svg {
  width: 14px;
  height: 14px;
}

@keyframes ai-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Label */
.${AI_LABEL_CLASS} {
  white-space: nowrap;
}

/* Result highlight */
.${AI_RESULT_CLASS} {
  background-color: rgba(46, 204, 113, 0.2);
  border-bottom: 2px solid rgba(46, 204, 113, 0.5);
}

/* Error highlight */
.${AI_ERROR_CLASS} {
  background-color: rgba(231, 76, 60, 0.1);
  border-bottom: 2px dashed rgba(231, 76, 60, 0.5);
}

.${AI_PROCESSING_INDICATOR_CLASS}.${AI_ERROR_CLASS} {
  color: #e74c3c;
  background-color: rgba(231, 76, 60, 0.1);
}
`;
