/**
 * AI Inline Decorations
 *
 * Creates ProseMirror decorations for the AI inline generation states:
 * prompting (inline input), loading (breathing pulse), preview (rendered content), and error.
 */

import { DecorationSet, Decoration, type EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import { aiInlineKey, type AIInlineState, type AIInlineMeta } from './state';

/**
 * Create decorations based on the current AI inline state.
 */
export function createAIInlineDecorations(state: EditorState): DecorationSet {
  const pluginState = aiInlineKey.getState(state);
  if (!pluginState || pluginState.status === 'idle' || !pluginState.blockPos) {
    return DecorationSet.empty;
  }

  const { from, to } = pluginState.blockPos;
  const docSize = state.doc.content.size;

  // Validate range
  if (from < 0 || to > docSize || from >= to) {
    return DecorationSet.empty;
  }

  const decorations: Decoration[] = [];

  switch (pluginState.status) {
    case 'prompting': {
      // Highlight the selected text
      decorations.push(
        Decoration.inline(from, to, { class: 'void-ai-inline-selection-highlight' })
      );
      // Prompt input widget at the end of the selection
      decorations.push(
        Decoration.widget(to, (view) => createPromptWidget(view), {
          side: 1,
          key: 'ai-inline-prompt',
        })
      );
      break;
    }

    case 'processing': {
      if (pluginState.mode === 'selection' && !pluginState.textReplaced) {
        // Selection mode (before replacement): dim original text + loading at end
        decorations.push(
          Decoration.inline(from, to, { class: 'void-ai-inline-dimmed' })
        );
        decorations.push(
          Decoration.widget(to, (view) => createLoadingWidget(pluginState.prompt, view), {
            side: 1,
            key: 'ai-inline-loading',
          })
        );
      } else {
        // Generate mode or retry: placeholder with loading
        decorations.push(
          Decoration.node(from, to, { class: 'void-ai-inline-processing' })
        );
        decorations.push(
          Decoration.widget(from + 1, (view) => createLoadingWidget(pluginState.prompt, view), {
            side: -1,
            key: 'ai-inline-loading',
          })
        );
      }
      break;
    }

    case 'preview': {
      if (pluginState.mode === 'selection' && !pluginState.textReplaced) {
        // Selection mode: dim original text + show preview widget after it
        decorations.push(
          Decoration.inline(from, to, { class: 'void-ai-inline-dimmed' })
        );
        decorations.push(
          Decoration.widget(
            to,
            (view) => createPreviewWidget(pluginState.resultHtml, view),
            { side: 1, key: 'ai-inline-preview' }
          )
        );
      } else {
        // Generate mode or after replacement: preview on placeholder node
        decorations.push(
          Decoration.node(from, to, { class: 'void-ai-inline-preview' })
        );
        decorations.push(
          Decoration.widget(
            from + 1,
            (view) => createPreviewWidget(pluginState.resultHtml, view),
            { side: -1, key: 'ai-inline-preview' }
          )
        );
      }
      break;
    }

    case 'error': {
      if (pluginState.mode === 'selection' && !pluginState.textReplaced) {
        // Selection mode error (text still in document): dim text + error widget at end
        decorations.push(
          Decoration.inline(from, to, { class: 'void-ai-inline-dimmed' })
        );
        decorations.push(
          Decoration.widget(
            to,
            (view) => createErrorWidget(pluginState.error ?? 'Unknown error', view),
            { side: 1, key: 'ai-inline-error' }
          )
        );
      } else {
        // Generate mode or after replacement: error on placeholder node
        decorations.push(
          Decoration.node(from, to, { class: 'void-ai-inline-error' })
        );
        decorations.push(
          Decoration.widget(
            from + 1,
            (view) => createErrorWidget(pluginState.error ?? 'Unknown error', view),
            { side: -1, key: 'ai-inline-error' }
          )
        );
      }
      break;
    }
  }

  return DecorationSet.create(state.doc, decorations);
}

/**
 * Create the inline prompt input widget for Cmd+J selection mode.
 */
function createPromptWidget(view: EditorView): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'void-ai-prompt-widget';
  wrapper.setAttribute('contenteditable', 'false');

  const input = document.createElement('input');
  input.className = 'void-ai-prompt-input';
  input.type = 'text';
  input.placeholder = 'Describe what to do with this text...';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');

  const submitBtn = document.createElement('button');
  submitBtn.className = 'void-ai-prompt-submit';
  submitBtn.type = 'button';
  submitBtn.innerHTML = '&#x21B5;';
  submitBtn.title = 'Submit (Enter)';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'void-ai-prompt-cancel';
  cancelBtn.type = 'button';
  cancelBtn.innerHTML = '&#x2715;';
  cancelBtn.title = 'Cancel (Esc)';

  const handleSubmit = () => {
    const prompt = input.value.trim();
    if (!prompt) return;
    view.dispatch(
      view.state.tr.setMeta(aiInlineKey, {
        type: 'PROMPT_SUBMIT',
        prompt,
      } satisfies AIInlineMeta)
    );
  };

  const handleCancel = () => {
    view.dispatch(
      view.state.tr.setMeta(aiInlineKey, { type: 'PROMPT_CANCEL' } satisfies AIInlineMeta)
    );
    view.focus();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleCancel();
    }
    // Stop all keydown events from reaching ProseMirror
    e.stopPropagation();
  });

  submitBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleSubmit();
  });

  cancelBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleCancel();
  });

  wrapper.appendChild(input);
  wrapper.appendChild(submitBtn);
  wrapper.appendChild(cancelBtn);

  // Auto-focus the input after it's added to the DOM
  setTimeout(() => input.focus(), 0);

  return wrapper;
}

/**
 * Create the loading widget with breathing pulse dot.
 */
function createLoadingWidget(prompt: string, view: EditorView): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'void-ai-inline-loading';
  wrapper.setAttribute('contenteditable', 'false');

  // Breathing pulse dot
  const dot = document.createElement('span');
  dot.className = 'void-ai-inline-pulse';

  // Prompt text (truncated)
  const text = document.createElement('span');
  text.className = 'void-ai-inline-prompt-text';
  const displayText = prompt.length > 60 ? prompt.slice(0, 57) + '...' : prompt;
  text.textContent = `Generating: "${displayText}"`;

  // Cancel button
  const cancel = document.createElement('button');
  cancel.className = 'void-ai-inline-cancel';
  cancel.textContent = 'Cancel';
  cancel.type = 'button';
  cancel.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    view.dispatch(
      view.state.tr.setMeta(aiInlineKey, { type: 'CANCEL' } satisfies AIInlineMeta)
    );
  });

  wrapper.appendChild(dot);
  wrapper.appendChild(text);
  wrapper.appendChild(cancel);

  return wrapper;
}

/**
 * Create the preview widget with rendered content and action buttons.
 */
function createPreviewWidget(resultHtml: string, view: EditorView): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'void-ai-preview';
  wrapper.setAttribute('contenteditable', 'false');

  // Header with action buttons
  const header = document.createElement('div');
  header.className = 'void-ai-preview-header';

  const denyBtn = document.createElement('button');
  denyBtn.className = 'void-ai-preview-deny';
  denyBtn.innerHTML = '&#x2715;';
  denyBtn.title = 'Deny (Esc)';
  denyBtn.type = 'button';
  denyBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    view.dispatch(
      view.state.tr.setMeta(aiInlineKey, { type: 'DENY' } satisfies AIInlineMeta)
    );
  });

  const retryBtn = document.createElement('button');
  retryBtn.className = 'void-ai-preview-retry';
  retryBtn.innerHTML = '&#x21bb; Retry';
  retryBtn.type = 'button';
  retryBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    view.dispatch(
      view.state.tr.setMeta(aiInlineKey, { type: 'RETRY' } satisfies AIInlineMeta)
    );
  });

  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'void-ai-preview-accept';
  acceptBtn.innerHTML = '&#x2713; Accept';
  acceptBtn.type = 'button';
  acceptBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    view.dispatch(
      view.state.tr.setMeta(aiInlineKey, { type: 'ACCEPT' } satisfies AIInlineMeta)
    );
  });

  header.appendChild(denyBtn);
  header.appendChild(retryBtn);
  header.appendChild(acceptBtn);

  // Content body with rendered HTML
  const content = document.createElement('div');
  content.className = 'void-ai-preview-content';
  content.innerHTML = resultHtml;

  // Footer with keyboard shortcuts
  const footer = document.createElement('div');
  footer.className = 'void-ai-preview-footer';
  footer.innerHTML =
    '<kbd>\u2318\u21B5</kbd> Accept\u2003' +
    '<kbd>\u2318R</kbd> Retry\u2003' +
    '<kbd>Esc</kbd> Deny';

  wrapper.appendChild(header);
  wrapper.appendChild(content);
  wrapper.appendChild(footer);

  return wrapper;
}

/**
 * Create the error widget with message and action buttons.
 */
function createErrorWidget(errorMessage: string, view: EditorView): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'void-ai-inline-error-content';
  wrapper.setAttribute('contenteditable', 'false');

  const text = document.createElement('span');
  text.textContent = errorMessage.length > 80
    ? errorMessage.slice(0, 77) + '...'
    : errorMessage;

  const retryBtn = document.createElement('button');
  retryBtn.className = 'void-ai-preview-retry';
  retryBtn.textContent = 'Retry';
  retryBtn.type = 'button';
  retryBtn.style.marginLeft = 'auto';
  retryBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    view.dispatch(
      view.state.tr.setMeta(aiInlineKey, { type: 'RETRY' } satisfies AIInlineMeta)
    );
  });

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'void-ai-inline-cancel';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.type = 'button';
  dismissBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    view.dispatch(
      view.state.tr.setMeta(aiInlineKey, { type: 'DENY' } satisfies AIInlineMeta)
    );
  });

  wrapper.appendChild(text);
  wrapper.appendChild(retryBtn);
  wrapper.appendChild(dismissBtn);

  return wrapper;
}
