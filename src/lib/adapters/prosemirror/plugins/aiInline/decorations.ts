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
        // Answer-only keeps the selected text dimmed; applied edits leave the document readable.
        if (!pluginState.didMutate) {
          decorations.push(
            Decoration.inline(from, to, { class: 'void-ai-inline-dimmed' })
          );
        }
        decorations.push(
          Decoration.widget(
            to,
            (view) => createPreviewWidget(pluginState.resultMarkdown, pluginState.resultHtml, pluginState, view),
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
            (view) => createPreviewWidget(pluginState.resultMarkdown, pluginState.resultHtml, pluginState, view),
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
  text.textContent = `Working: "${displayText}"`;

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
 * Create the final result widget with rendered content and action buttons.
 */
function createPreviewWidget(
  resultMarkdown: string,
  resultHtml: string,
  state: AIInlineState,
  view: EditorView
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'void-ai-preview';
  wrapper.setAttribute('contenteditable', 'false');

  const header = document.createElement('div');
  header.className = 'void-ai-preview-header';

  const status = document.createElement('div');
  status.className = 'void-ai-preview-status';

  const badge = document.createElement('span');
  badge.className = state.didMutate ? 'void-ai-preview-badge edited' : 'void-ai-preview-badge answer';
  badge.textContent = state.didMutate ? 'Edited' : 'Answer';

  const detail = document.createElement('span');
  detail.className = 'void-ai-preview-detail';
  detail.textContent = state.toolCount > 0
    ? `${state.toolCount} tool${state.toolCount === 1 ? '' : 's'} used`
    : 'No note changes';

  status.appendChild(badge);
  status.appendChild(detail);

  const actions = document.createElement('div');
  actions.className = 'void-ai-preview-actions';

  const retryBtn = document.createElement('button');
  retryBtn.className = 'void-ai-preview-retry';
  retryBtn.textContent = 'Retry';
  retryBtn.title = 'Retry';
  retryBtn.type = 'button';
  retryBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    view.dispatch(
      view.state.tr.setMeta(aiInlineKey, { type: 'RETRY' } satisfies AIInlineMeta)
    );
  });

  const copyBtn = document.createElement('button');
  copyBtn.className = 'void-ai-preview-copy';
  copyBtn.textContent = 'Copy';
  copyBtn.title = 'Copy response';
  copyBtn.type = 'button';
  copyBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void navigator.clipboard?.writeText(resultMarkdown || stripHtml(resultHtml)).then(() => {
      copyBtn.textContent = 'Copied';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 1200);
    });
  });

  const chatBtn = document.createElement('button');
  chatBtn.className = 'void-ai-preview-open';
  chatBtn.textContent = 'Open chat';
  chatBtn.title = 'Open chat';
  chatBtn.type = 'button';
  chatBtn.disabled = !state.conversationId;
  chatBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!state.conversationId) return;
    window.dispatchEvent(
      new CustomEvent('void:open-ai-chat', {
        detail: { conversationId: state.conversationId },
      })
    );
  });

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'void-ai-preview-dismiss';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.title = 'Dismiss';
  dismissBtn.type = 'button';
  dismissBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    view.dispatch(
      view.state.tr.setMeta(aiInlineKey, { type: 'DENY' } satisfies AIInlineMeta)
    );
  });

  actions.appendChild(retryBtn);
  actions.appendChild(copyBtn);
  actions.appendChild(chatBtn);
  actions.appendChild(dismissBtn);
  header.appendChild(status);
  header.appendChild(actions);

  const content = document.createElement('div');
  content.className = 'void-ai-preview-content';
  content.innerHTML = resultHtml;

  wrapper.appendChild(header);
  wrapper.appendChild(content);

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

function stripHtml(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent ?? '';
}
