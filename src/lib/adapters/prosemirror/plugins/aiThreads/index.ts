import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Node as PmNode } from 'prosemirror-model';
import type {
  InlineAIProposedChange,
  InlineAIThread,
  InlineAIThreadStatus,
} from '$lib/domain/entities/InlineAIThread';
import { renderMarkdownToHtml } from '../../../markdown/parser';
import { AI_BYPASS } from '../aiBlock';

interface AIThreadWidgetState {
  thread: InlineAIThread;
  from: number;
  to: number;
  pos: number;
  cardPos: number;
  unresolved: boolean;
}

interface AIThreadsState {
  widgets: AIThreadWidgetState[];
}

interface AIThreadWidgetGroups {
  standalone: AIThreadWidgetState[];
  appliedGroups: AIThreadWidgetState[][];
}

type AIThreadsMeta = { type: 'SET_THREADS'; threads: InlineAIThread[] };

export const aiThreadsKey = new PluginKey<AIThreadsState>('aiThreads');

export function createAIThreadsPlugin(): Plugin<AIThreadsState> {
  return new Plugin<AIThreadsState>({
    key: aiThreadsKey,
    state: {
      init: (_, state) => ({ widgets: resolveThreads(state.doc, []) }),
      apply(tr: Transaction, pluginState: AIThreadsState): AIThreadsState {
        const meta = tr.getMeta(aiThreadsKey) as AIThreadsMeta | undefined;
        if (meta?.type === 'SET_THREADS') {
          return { widgets: resolveThreads(tr.doc, meta.threads) };
        }
        if (!tr.docChanged) return pluginState;
        return {
          widgets: pluginState.widgets.map((widget) => ({
            ...widget,
            from: tr.mapping.map(widget.from),
            to: tr.mapping.map(widget.to),
            pos: tr.mapping.map(widget.pos, 1),
            cardPos: tr.mapping.map(widget.cardPos, 1),
          })),
        };
      },
    },
    filterTransaction(tr: Transaction, state) {
      if (!tr.docChanged) return true;
      if (tr.getMeta(AI_BYPASS)) return true;
      if (tr.getMeta(aiThreadsKey)) return true;

      const pluginState = aiThreadsKey.getState(state);
      if (!pluginState) return true;

      const protectedWidgets = pluginState.widgets.filter(isProtectedWidget);
      if (protectedWidgets.length === 0) return true;

      return !protectedWidgets.some((widget) =>
        transactionTouchesRange(tr, widget.from, widget.to),
      );
    },
    props: {
      decorations(state) {
        const pluginState = aiThreadsKey.getState(state);
        if (!pluginState || pluginState.widgets.length === 0) return DecorationSet.empty;

        const decorations: Decoration[] = [];
        const groups = groupThreadWidgets(pluginState.widgets);

        for (const widget of groups.standalone) {
          decorations.push(...createAnchorDecorations(widget));
          decorations.push(
            Decoration.widget(
              Math.min(widget.cardPos, state.doc.content.size),
              (view) => createThreadCard(view, widget.thread, widget.unresolved),
              {
                side: 1,
                key: `inline-ai-thread-${widget.thread.id}-${widget.thread.updatedAt}`,
              },
            ),
          );
        }

        for (const group of groups.appliedGroups) {
          const primary = latestWidget(group);
          decorations.push(...createAnchorDecorations(primary));
          decorations.push(
            Decoration.widget(
              Math.min(primary.pos, state.doc.content.size),
              (view) => createAppliedChip(view, group.map((widget) => widget.thread), {
                floating: isAtTextblockEnd(state.doc, primary.pos),
              }),
              {
                side: 1,
                key: `inline-ai-applied-group-${groupKey(primary)}-${group
                  .map((widget) => `${widget.thread.id}:${widget.thread.updatedAt}`)
                  .join('|')}`,
              },
            ),
          );
        }

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

export function setAIThreads(view: EditorView, threads: InlineAIThread[]): void {
  view.dispatch(view.state.tr.setMeta(aiThreadsKey, { type: 'SET_THREADS', threads } satisfies AIThreadsMeta));
}

function resolveThreads(doc: PmNode, threads: InlineAIThread[]): AIThreadWidgetState[] {
  return threads
    .filter((thread) => !thread.dismissedAt)
    .map((thread) => resolveThread(doc, thread));
}

function groupThreadWidgets(widgets: AIThreadWidgetState[]): AIThreadWidgetGroups {
  const standalone: AIThreadWidgetState[] = [];
  const appliedByLocation = new Map<string, AIThreadWidgetState[]>();

  for (const widget of widgets) {
    if (widget.thread.dismissedAt) continue;
    if (widget.thread.status !== 'applied') {
      standalone.push(widget);
      continue;
    }

    const key = groupKey(widget);
    const group = appliedByLocation.get(key);
    if (group) group.push(widget);
    else appliedByLocation.set(key, [widget]);
  }

  return {
    standalone,
    appliedGroups: [...appliedByLocation.values()],
  };
}

function createAnchorDecorations(widget: AIThreadWidgetState): Decoration[] {
  if (widget.unresolved || widget.from >= widget.to) return [];
  const classes = ['void-ai-thread-anchor'];
  if (!widget.thread.seenAt) classes.push('unread');
  if (isProtectedThread(widget.thread)) classes.push('locked');
  return [
    Decoration.inline(widget.from, widget.to, {
      class: classes.join(' '),
    }),
  ];
}

function groupKey(widget: AIThreadWidgetState): string {
  return `${widget.pos}:${widget.from}:${widget.to}`;
}

function latestWidget(widgets: AIThreadWidgetState[]): AIThreadWidgetState {
  return widgets
    .slice()
    .sort((left, right) => right.thread.updatedAt.localeCompare(left.thread.updatedAt))[0] ?? widgets[0]!;
}

function isProtectedWidget(widget: AIThreadWidgetState): boolean {
  return !widget.unresolved && widget.from < widget.to && isProtectedThread(widget.thread);
}

function isProtectedThread(thread: InlineAIThread): boolean {
  return thread.status === 'generating' || thread.proposal?.status === 'pending';
}

function transactionTouchesRange(tr: Transaction, from: number, to: number): boolean {
  let touches = false;

  tr.mapping.maps.forEach((stepMap) => {
    if (touches) return;
    stepMap.forEach((oldStart, oldEnd) => {
      if (touches) return;

      if (oldStart === oldEnd) {
        touches = oldStart > from && oldStart < to;
        return;
      }

      touches = oldStart < to && oldEnd > from;
    });
  });

  return touches;
}

function resolveThread(doc: PmNode, thread: InlineAIThread): AIThreadWidgetState {
  const range = thread.anchor.range;
  if (range && range.from >= 0 && range.to <= doc.content.size && range.from <= range.to) {
    const current = doc.textBetween(range.from, range.to, '\n');
    if (!thread.anchor.selectedText || equivalentAnchorText(current, thread.anchor.selectedText)) {
      return {
        thread,
        from: range.from,
        to: range.to,
        pos: range.to,
        cardPos: positionAfterContainingBlock(doc, range.to),
        unresolved: false,
      };
    }

    const blockMatch = findBlockRange(doc, thread.anchor.blockIds);
    if (blockMatch && rangesOverlap(range, blockMatch)) {
      return {
        thread,
        from: range.from,
        to: range.to,
        pos: range.to,
        cardPos: positionAfterContainingBlock(doc, range.to),
        unresolved: false,
      };
    }
  }

  const textMatch = findTextRange(doc, thread.anchor.selectedText);
  if (textMatch) {
    return {
      thread,
      from: textMatch.from,
      to: textMatch.to,
      pos: textMatch.to,
      cardPos: positionAfterContainingBlock(doc, textMatch.to),
      unresolved: false,
    };
  }

  const blockMatch = findBlockRange(doc, thread.anchor.blockIds);
  if (blockMatch) {
    return {
      thread,
      from: blockMatch.from,
      to: blockMatch.to,
      pos: blockMatch.to,
      cardPos: blockMatch.to,
      unresolved: true,
    };
  }

  const end = Math.max(0, doc.content.size);
  return { thread, from: end, to: end, pos: end, cardPos: end, unresolved: true };
}

function equivalentAnchorText(left: string, right: string): boolean {
  return normalizeAnchorText(left) === normalizeAnchorText(right);
}

function normalizeAnchorText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function rangesOverlap(
  left: { from: number; to: number },
  right: { from: number; to: number },
): boolean {
  return left.from <= right.to && right.from <= left.to;
}

function findTextRange(doc: PmNode, needle: string): { from: number; to: number } | null {
  if (!needle.trim()) return null;
  let result: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (result) return false;
    if (!node.isText || !node.text) return true;
    const index = node.text.indexOf(needle);
    if (index < 0) return true;
    result = { from: pos + index, to: pos + index + needle.length };
    return false;
  });
  return result;
}

function findBlockRange(doc: PmNode, blockIds: string[]): { from: number; to: number } | null {
  const ids = new Set(blockIds);
  if (ids.size === 0) return null;
  let result: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (result) return false;
    const id = node.attrs?.id as string | undefined;
    if (!id || !ids.has(id)) return true;
    result = { from: pos, to: pos + node.nodeSize };
    return false;
  });
  return result;
}

function positionAfterContainingBlock(doc: PmNode, pos: number): number {
  const safePos = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(safePos);

  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (!node.isBlock) continue;
    return Math.min($pos.before(depth) + node.nodeSize, doc.content.size);
  }

  if ($pos.nodeBefore?.isBlock) return safePos;
  return safePos;
}

function isAtTextblockEnd(doc: PmNode, pos: number): boolean {
  const safePos = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(safePos);
  return $pos.parent.isTextblock && $pos.parentOffset >= $pos.parent.content.size;
}

function createThreadCard(
  _view: EditorView,
  thread: InlineAIThread,
  unresolved: boolean,
): HTMLElement {
  const wrapper = document.createElement('section');
  wrapper.className = `void-ai-thread-card status-${thread.status}${thread.seenAt ? '' : ' unread'}`;
  wrapper.dataset.inlineAiThreadId = thread.id;
  wrapper.setAttribute('contenteditable', 'false');
  wrapper.setAttribute('aria-label', 'AI response');

  const latest = thread.turns.at(-1);
  const header = document.createElement('div');
  header.className = 'void-ai-thread-header';

  const status = document.createElement('div');
  status.className = 'void-ai-thread-status';
  const badge = document.createElement('span');
  badge.className = 'void-ai-thread-badge';
  badge.textContent = statusLabel(thread.status, thread.proposal?.status);
  const prompt = document.createElement('span');
  prompt.className = 'void-ai-thread-prompt';
  prompt.textContent = latest?.prompt ?? 'Inline AI';
  status.append(badge, prompt);

  const actions = document.createElement('div');
  actions.className = 'void-ai-thread-actions';
  if (thread.proposal?.status === 'pending') {
    actions.append(
      actionButton('Accept', 'accept', thread.id, 'Accept proposed edit'),
      actionButton('Cancel', 'cancel', thread.id, 'Cancel proposal'),
    );
  }
  if (thread.status !== 'generating') {
    actions.append(actionButton('Retry', 'retry', thread.id, 'Retry response'));
  }
  actions.append(
    actionButton('Copy', 'copy', thread.id, 'Copy response'),
    actionButton('Open chat', 'open-chat', thread.id, 'Open related chat'),
    iconButton('Dismiss', 'dismiss', thread.id, 'Dismiss response'),
  );

  header.append(status, actions);

  const content = document.createElement('div');
  content.className = 'void-ai-thread-content';
  content.innerHTML = renderMarkdownToHtml(latest?.response || (thread.status === 'generating' ? 'Working...' : ''));

  wrapper.append(header);
  if (unresolved || thread.status === 'stale') {
    const note = document.createElement('p');
    note.className = 'void-ai-thread-warning';
    note.textContent = thread.proposal?.staleReason ?? 'The original anchor moved. Retry before applying edits.';
    wrapper.append(note);
  }
  wrapper.append(content);

  if (thread.proposal) {
    wrapper.append(createProposalPreview(thread.proposal.changes));
  }

  wrapper.append(createFollowUpForm(thread.id));
  wrapper.addEventListener('mousedown', (event) => event.stopPropagation());
  wrapper.addEventListener('keydown', (event) => event.stopPropagation());
  return wrapper;
}

function createAppliedChip(
  _view: EditorView,
  threads: InlineAIThread[],
  options: { floating?: boolean } = {},
): HTMLElement {
  ensureAppliedPopoverListeners();
  const primary = latestThread(threads);
  const threadIds = threads.map((thread) => thread.id);
  const wrapper = document.createElement('span');
  wrapper.className = options.floating
    ? 'void-ai-thread-popover void-ai-thread-popover--floating'
    : 'void-ai-thread-popover';
  wrapper.dataset.inlineAiThreadId = primary.id;
  wrapper.dataset.inlineAiThreadIds = threadIds.join(' ');
  wrapper.setAttribute('contenteditable', 'false');
  wrapper.setAttribute(
    'aria-label',
    threads.length === 1 ? 'Applied AI edit' : `${threads.length} applied AI edits here`,
  );

  const panelId = `inline-ai-popover-${primary.id}`;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'void-ai-thread-chip void-ai-thread-chip-trigger status-applied';
  trigger.dataset.inlineAiThreadId = primary.id;
  trigger.dataset.inlineAiThreadIds = threadIds.join(' ');
  trigger.title = threads.length === 1 ? 'Applied AI edit' : `${threads.length} applied AI conversations here`;
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', panelId);

  const label = document.createElement('span');
  label.className = 'void-ai-thread-chip-label';
  label.textContent = 'Applied';
  trigger.append(label);

  if (threads.length > 1) {
    const count = document.createElement('span');
    count.className = 'void-ai-thread-chip-count';
    count.textContent = String(threads.length);
    count.setAttribute('aria-label', `${threads.length} applied AI edits`);
    trigger.append(count);
  }

  const chevron = document.createElement('span');
  chevron.className = 'void-ai-thread-chip-chevron';
  chevron.textContent = '⌄';
  chevron.setAttribute('aria-hidden', 'true');
  trigger.append(chevron);

  trigger.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setAppliedPopoverOpen(wrapper, !wrapper.classList.contains('open'));
  });

  const panel = document.createElement('div');
  panel.id = panelId;
  panel.className = 'void-ai-thread-popover-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', threads.length === 1 ? 'Applied AI edit actions' : 'Applied AI conversations');
  panel.append(createAppliedPopoverContent(threads, primary, threadIds));

  wrapper.append(trigger, panel);
  wrapper.addEventListener('mousedown', (event) => event.stopPropagation());
  wrapper.addEventListener('keydown', (event) => event.stopPropagation());
  return wrapper;
}

function createAppliedPopoverContent(
  threads: InlineAIThread[],
  primary: InlineAIThread,
  threadIds: string[],
): HTMLElement {
  const content = document.createElement('div');
  content.className = 'void-ai-thread-popover-content';
  const header = document.createElement('div');
  header.className = 'void-ai-thread-popover-head';
  const title = document.createElement('span');
  title.textContent = threads.length === 1 ? 'Applied edit' : `${threads.length} conversations here`;
  header.append(title);
  if (threads.length > 1) {
    header.append(popoverActionButton('Hide all', 'dismiss-cluster', primary.id, 'Hide all markers here', {
      threadIds,
      subtle: true,
    }));
  }
  content.append(header);

  const list = document.createElement(threads.length === 1 ? 'div' : 'ol');
  list.className = threads.length === 1 ? 'void-ai-thread-popover-single' : 'void-ai-thread-popover-list';
  for (const thread of threads.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))) {
    list.append(createAppliedPopoverRow(thread, threads.length === 1));
  }
  content.append(list);
  return content;
}

function createAppliedPopoverRow(thread: InlineAIThread, single: boolean): HTMLElement {
  const item = document.createElement(single ? 'div' : 'li');
  item.className = single ? 'void-ai-thread-popover-row single' : 'void-ai-thread-popover-row';

  const body = document.createElement('div');
  body.className = 'void-ai-thread-popover-row-body';
  const prompt = document.createElement('span');
  prompt.className = 'void-ai-thread-popover-prompt';
  prompt.textContent = compactText(thread.turns.at(-1)?.prompt ?? thread.invocation.prompt ?? 'Inline AI', 80);
  const response = document.createElement('span');
  response.className = 'void-ai-thread-popover-response';
  response.textContent = compactText(thread.turns.at(-1)?.response ?? 'Applied edit', 96);
  body.append(prompt, response);

  const actions = document.createElement('div');
  actions.className = 'void-ai-thread-popover-actions';
  actions.append(
    popoverActionButton('Chat', 'open-chat', thread.id, 'Open related chat', { primary: true }),
    popoverActionButton('Copy', 'copy', thread.id, 'Copy response'),
    popoverActionButton('History', 'open-history', thread.id, 'Show in AI history'),
    popoverActionButton('Hide', 'dismiss', thread.id, 'Hide marker'),
  );

  item.append(body, actions);
  return item;
}

function latestThread(threads: InlineAIThread[]): InlineAIThread {
  return threads
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? threads[0]!;
}

function compactText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1))}…`;
}

let appliedPopoverListenersInstalled = false;

function ensureAppliedPopoverListeners(): void {
  if (appliedPopoverListenersInstalled || typeof document === 'undefined') return;
  appliedPopoverListenersInstalled = true;
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.void-ai-thread-popover')) return;
    closeAppliedPopovers();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAppliedPopovers();
  });
}

function closeAppliedPopovers(except?: HTMLElement): void {
  document.querySelectorAll<HTMLElement>('.void-ai-thread-popover.open').forEach((popover) => {
    if (popover !== except) setAppliedPopoverOpen(popover, false);
  });
}

function setAppliedPopoverOpen(popover: HTMLElement, open: boolean): void {
  if (open) closeAppliedPopovers(popover);
  popover.classList.toggle('open', open);
  const trigger = popover.querySelector<HTMLButtonElement>('.void-ai-thread-chip-trigger');
  const panel = popover.querySelector<HTMLElement>('.void-ai-thread-popover-panel');
  trigger?.setAttribute('aria-expanded', String(open));
  if (panel) panel.hidden = !open;
}

function popoverActionButton(
  label: string,
  action: string,
  threadId: string,
  title: string,
  options: {
    primary?: boolean;
    subtle?: boolean;
    threadIds?: string[];
  } = {},
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'void-ai-thread-popover-action';
  if (options.primary) button.className += ' primary';
  if (options.subtle) button.className += ' subtle';
  button.textContent = label;
  button.title = title;
  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dispatchThreadAction(action, threadId, options.threadIds ? { threadIds: options.threadIds } : {});
    const popover = button.closest<HTMLElement>('.void-ai-thread-popover');
    if (popover) setAppliedPopoverOpen(popover, false);
  });
  return button;
}

function actionButton(label: string, action: string, threadId: string, title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `void-ai-thread-action action-${action}`;
  button.textContent = label;
  button.title = title;
  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dispatchThreadAction(action, threadId);
  });
  return button;
}

function iconButton(label: string, action: string, threadId: string, title: string): HTMLButtonElement {
  const button = actionButton('x', action, threadId, title);
  button.className += ' icon-only';
  button.setAttribute('aria-label', label);
  return button;
}

function createProposalPreview(changes: InlineAIProposedChange[]): HTMLElement {
  const details = document.createElement('details');
  details.className = 'void-ai-thread-preview';
  details.open = true;

  const summary = document.createElement('summary');
  summary.textContent = changes.length === 1 ? 'Preview proposed edit' : `Preview ${changes.length} proposed edits`;
  details.append(summary);

  for (const change of changes) {
    const item = document.createElement('div');
    item.className = 'void-ai-thread-change';
    const label = document.createElement('div');
    label.className = 'void-ai-thread-change-label';
    label.textContent = changeLabel(change);
    item.append(label);

    const before = changeBefore(change);
    if (before) item.append(codeBlock('Before', before));
    item.append(codeBlock('After', changeAfter(change)));
    details.append(item);
  }
  return details;
}

function createFollowUpForm(threadId: string): HTMLElement {
  const form = document.createElement('form');
  form.className = 'void-ai-thread-followup';
  const input = document.createElement('input');
  input.type = 'text';
  input.name = 'inline-ai-follow-up';
  input.placeholder = 'Follow up...';
  input.setAttribute('aria-label', 'Follow up');
  stopEditorEventPropagation(input);
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = 'Send';
  form.append(input, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const prompt = input.value.trim();
    if (!prompt) return;
    dispatchThreadAction('follow-up', threadId, { prompt });
    input.value = '';
  });
  return form;
}

function stopEditorEventPropagation(element: HTMLElement): void {
  const events = [
    'mousedown',
    'mouseup',
    'pointerdown',
    'pointerup',
    'click',
    'dblclick',
    'keydown',
    'keyup',
    'keypress',
    'beforeinput',
    'input',
    'copy',
    'cut',
    'paste',
    'select',
    'selectionchange',
  ] as const;

  for (const eventName of events) {
    element.addEventListener(eventName, (event) => {
      event.stopPropagation();
    });
  }
}

function codeBlock(label: string, value: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'void-ai-thread-code';
  const title = document.createElement('span');
  title.textContent = label;
  const pre = document.createElement('pre');
  pre.textContent = value;
  wrapper.append(title, pre);
  return wrapper;
}

function dispatchThreadAction(action: string, threadId: string, extra: Record<string, unknown> = {}): void {
  window.dispatchEvent(new CustomEvent('void:inline-ai-thread-action', {
    detail: { action, threadId, ...extra },
  }));
}

function statusLabel(status: InlineAIThreadStatus, proposalStatus?: string): string {
  if (status === 'answer') return 'Answer';
  if (status === 'proposed' && proposalStatus === 'pending') return 'Proposed edit';
  if (status === 'applied') return 'Applied';
  if (status === 'canceled') return 'Canceled';
  if (status === 'stale') return 'Stale';
  if (status === 'error') return 'Error';
  return 'Working';
}

function changeLabel(change: InlineAIProposedChange): string {
  switch (change.kind) {
    case 'replace-range':
      return `Replace range ${change.from}-${change.to}`;
    case 'replace-block':
      return `Replace block ${change.blockId}`;
    case 'insert-blocks':
      return `Insert after ${change.afterBlockId}`;
    case 'apply-note-patch':
      return `Full-note patch for ${change.noteId}`;
  }
}

function changeBefore(change: InlineAIProposedChange): string | null {
  switch (change.kind) {
    case 'replace-range':
      return change.originalText;
    case 'replace-block':
      return change.originalText ?? null;
    case 'insert-blocks':
      return null;
    case 'apply-note-patch':
      return 'Current note snapshot';
  }
}

function changeAfter(change: InlineAIProposedChange): string {
  switch (change.kind) {
    case 'replace-range':
    case 'replace-block':
    case 'insert-blocks':
      return change.markdown;
    case 'apply-note-patch':
      return change.content.length > 1600
        ? `${change.content.slice(0, 1600)}\n...`
        : change.content;
  }
}
