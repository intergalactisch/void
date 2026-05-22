/**
 * InlineAIThread - persisted sidecar state for note-bound inline AI replies.
 *
 * These records live in .void/ and never become markdown. The markdown note
 * remains portable while the app can restore AI responses, proposals, and
 * unread state around the text they were created from.
 */

import type { ToolCall } from '../values/AIResponse';

export type InlineAIThreadStatus =
  | 'generating'
  | 'answer'
  | 'proposed'
  | 'applied'
  | 'canceled'
  | 'stale'
  | 'error';

export type InlineAIProposalStatus =
  | 'pending'
  | 'accepted'
  | 'canceled'
  | 'stale'
  | 'superseded';

export type InlineAIInvocationSource = 'inline-note-ask';

export type InlineAIInvocationEntryPoint =
  | 'selection-toolbar'
  | 'slash-menu'
  | 'keyboard'
  | 'unknown';

export type InlineAIThreadEventType =
  | 'created'
  | 'response_completed'
  | 'proposal_created'
  | 'accepted'
  | 'canceled'
  | 'retried'
  | 'followed_up'
  | 'stale'
  | 'error'
  | 'dismissed'
  | 'seen';

export interface InlineAIRange {
  from: number;
  to: number;
}

export interface InlineAIAnchor {
  notePath: string;
  selectedText: string;
  beforeText: string;
  afterText: string;
  range: InlineAIRange | null;
  blockIds: string[];
  baseHash: string;
  createdAt: string;
}

export interface InlineAIInvocation {
  source: InlineAIInvocationSource;
  entryPoint: InlineAIInvocationEntryPoint;
  notePath: string;
  prompt: string;
  selectedText: string;
  range: InlineAIRange | null;
  blockIds: string[];
  beforeText: string;
  afterText: string;
  createdAt: string;
}

export interface InlineAIReplaceRangeChange {
  kind: 'replace-range';
  from: number;
  to: number;
  markdown: string;
  originalText: string;
}

export interface InlineAIReplaceBlockChange {
  kind: 'replace-block';
  blockId: string;
  markdown: string;
  originalText?: string;
}

export interface InlineAIInsertBlocksChange {
  kind: 'insert-blocks';
  afterBlockId: string;
  markdown: string;
}

export interface InlineAIApplyNotePatchChange {
  kind: 'apply-note-patch';
  noteId: string;
  content: string;
  baseHash: string;
}

export type InlineAIProposedChange =
  | InlineAIReplaceRangeChange
  | InlineAIReplaceBlockChange
  | InlineAIInsertBlocksChange
  | InlineAIApplyNotePatchChange;

export interface InlineAIProposal {
  id: string;
  status: InlineAIProposalStatus;
  createdAt: string;
  updatedAt: string;
  baseHash: string;
  changes: InlineAIProposedChange[];
  staleReason?: string;
}

export interface InlineAITurn {
  id: string;
  prompt: string;
  response: string;
  status: InlineAIThreadStatus;
  createdAt: string;
  completedAt?: string;
  toolCalls: ToolCall[];
  proposalId?: string;
  error?: string;
}

export interface InlineAIThreadEvent {
  id: string;
  type: InlineAIThreadEventType;
  createdAt: string;
  turnId?: string;
  proposalId?: string;
  conversationId?: string | null;
  provenanceEventId?: string;
  lineageClusterId?: string;
  message?: string;
}

export interface InlineAIThreadLinks {
  provenanceEventIds: string[];
  lineageClusterIds: string[];
  lineagePatchIds: string[];
  lineageIntentIds: string[];
}

export interface InlineAIThread {
  id: string;
  notePath: string;
  conversationId: string | null;
  invocation: InlineAIInvocation;
  anchor: InlineAIAnchor;
  turns: InlineAITurn[];
  status: InlineAIThreadStatus;
  proposal: InlineAIProposal | null;
  events: InlineAIThreadEvent[];
  links: InlineAIThreadLinks;
  createdAt: string;
  updatedAt: string;
  seenAt: string | null;
  dismissedAt: string | null;
}

export interface CreateInlineAIThreadInput {
  notePath: string;
  conversationId?: string | null;
  anchor: InlineAIAnchor;
  prompt: string;
  entryPoint?: InlineAIInvocationEntryPoint;
}

export function createInlineAIAnchor(input: {
  notePath: string;
  selectedText: string;
  range: InlineAIRange | null;
  blockIds?: string[];
  surroundingText?: string;
  beforeText?: string;
  afterText?: string;
}): InlineAIAnchor {
  const surrounding = input.surroundingText ?? input.selectedText;
  const selectedIndex = input.selectedText
    ? surrounding.indexOf(input.selectedText)
    : -1;
  const beforeText = input.beforeText ?? (selectedIndex >= 0
    ? surrounding.slice(Math.max(0, selectedIndex - 160), selectedIndex)
    : '');
  const afterText = input.afterText ?? (selectedIndex >= 0
    ? surrounding.slice(selectedIndex + input.selectedText.length, selectedIndex + input.selectedText.length + 160)
    : '');

  return {
    notePath: input.notePath,
    selectedText: input.selectedText,
    beforeText,
    afterText,
    range: input.range,
    blockIds: input.blockIds ?? [],
    baseHash: hashInlineAIText(input.selectedText),
    createdAt: nowIso(),
  };
}

export function createInlineAIThread(input: CreateInlineAIThreadInput): InlineAIThread {
  const now = nowIso();
  const turn: InlineAITurn = {
    id: createInlineAIId('turn'),
    prompt: input.prompt,
    response: '',
    status: 'generating',
    createdAt: now,
    toolCalls: [],
  };

  return {
    id: createInlineAIId('thread'),
    notePath: input.notePath,
    conversationId: input.conversationId ?? null,
    invocation: {
      source: 'inline-note-ask',
      entryPoint: input.entryPoint ?? 'unknown',
      notePath: input.notePath,
      prompt: input.prompt,
      selectedText: input.anchor.selectedText,
      range: input.anchor.range,
      blockIds: input.anchor.blockIds,
      beforeText: input.anchor.beforeText,
      afterText: input.anchor.afterText,
      createdAt: now,
    },
    anchor: input.anchor,
    turns: [turn],
    status: 'generating',
    proposal: null,
    events: [{
      id: createInlineAIId('event'),
      type: 'created',
      createdAt: now,
      turnId: turn.id,
      conversationId: input.conversationId ?? null,
    }],
    links: createEmptyInlineAIThreadLinks(),
    createdAt: now,
    updatedAt: now,
    seenAt: null,
    dismissedAt: null,
  };
}

export function appendInlineAITurn(
  thread: InlineAIThread,
  prompt: string,
): InlineAIThread {
  const now = nowIso();
  const existingProposal = thread.proposal?.status === 'pending'
    ? markInlineAIProposal(thread.proposal, 'superseded')
    : thread.proposal;

  return {
    ...thread,
    status: 'generating',
    proposal: existingProposal,
    turns: [
      ...thread.turns,
      {
        id: createInlineAIId('turn'),
        prompt,
        response: '',
        status: 'generating',
        createdAt: now,
        toolCalls: [],
      },
    ],
    updatedAt: now,
    dismissedAt: null,
  };
}

export function completeInlineAITurn(
  thread: InlineAIThread,
  input: {
    response: string;
    toolCalls: ToolCall[];
    conversationId?: string | null;
    proposal?: InlineAIProposal | null;
  },
): InlineAIThread {
  const now = nowIso();
  const latestIndex = Math.max(0, thread.turns.length - 1);
  const status: InlineAIThreadStatus = input.proposal ? 'proposed' : 'answer';
  const turns = thread.turns.map((turn, index) => {
    if (index !== latestIndex) return turn;
    const updated: InlineAITurn = {
      ...turn,
      response: input.response,
      status,
      completedAt: now,
      toolCalls: input.toolCalls,
    };
    if (input.proposal) updated.proposalId = input.proposal.id;
    return updated;
  });

  return {
    ...thread,
    turns,
    status,
    proposal: input.proposal ?? null,
    conversationId: input.conversationId ?? thread.conversationId,
    updatedAt: now,
    seenAt: null,
  };
}

export function failInlineAITurn(thread: InlineAIThread, message: string): InlineAIThread {
  const now = nowIso();
  const latestIndex = Math.max(0, thread.turns.length - 1);
  return {
    ...thread,
    status: 'error',
    turns: thread.turns.map((turn, index) => index === latestIndex
      ? { ...turn, status: 'error', response: message, error: message, completedAt: now }
      : turn),
    updatedAt: now,
  };
}

export function appendInlineAIThreadEvent(
  thread: InlineAIThread,
  input: Omit<InlineAIThreadEvent, 'id' | 'createdAt'>,
): InlineAIThread {
  const now = nowIso();
  return {
    ...thread,
    events: [
      ...getInlineAIThreadEvents(thread),
      {
        id: createInlineAIId('event'),
        createdAt: now,
        ...input,
      },
    ],
    updatedAt: now,
  };
}

export function withInlineAIThreadLinks(
  thread: InlineAIThread,
  links: Partial<InlineAIThreadLinks>,
): InlineAIThread {
  const current = getInlineAIThreadLinks(thread);
  return {
    ...thread,
    links: {
      provenanceEventIds: mergeUnique(current.provenanceEventIds, links.provenanceEventIds),
      lineageClusterIds: mergeUnique(current.lineageClusterIds, links.lineageClusterIds),
      lineagePatchIds: mergeUnique(current.lineagePatchIds, links.lineagePatchIds),
      lineageIntentIds: mergeUnique(current.lineageIntentIds, links.lineageIntentIds),
    },
    updatedAt: nowIso(),
  };
}

export function createInlineAIProposal(
  changes: InlineAIProposedChange[],
  baseHash: string,
): InlineAIProposal {
  const now = nowIso();
  return {
    id: createInlineAIId('proposal'),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    baseHash,
    changes,
  };
}

export function markInlineAIProposal(
  proposal: InlineAIProposal,
  status: InlineAIProposalStatus,
  staleReason?: string,
): InlineAIProposal {
  return {
    ...proposal,
    status,
    updatedAt: nowIso(),
    ...(staleReason ? { staleReason } : {}),
  };
}

export function markInlineAIThreadSeen(thread: InlineAIThread): InlineAIThread {
  if (thread.seenAt) return thread;
  return appendInlineAIThreadEvent(
    { ...thread, seenAt: nowIso(), updatedAt: nowIso() },
    { type: 'seen' },
  );
}

export function dismissInlineAIThread(thread: InlineAIThread): InlineAIThread {
  const now = nowIso();
  return { ...thread, dismissedAt: now, seenAt: thread.seenAt ?? now, updatedAt: now };
}

export function isInlineAIThreadUnread(thread: InlineAIThread): boolean {
  return !thread.dismissedAt && !thread.seenAt && thread.status !== 'generating';
}

export function hashInlineAIText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function createInlineAIId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createEmptyInlineAIThreadLinks(): InlineAIThreadLinks {
  return {
    provenanceEventIds: [],
    lineageClusterIds: [],
    lineagePatchIds: [],
    lineageIntentIds: [],
  };
}

function getInlineAIThreadEvents(thread: InlineAIThread): InlineAIThreadEvent[] {
  return Array.isArray(thread.events) ? thread.events : [];
}

function getInlineAIThreadLinks(thread: InlineAIThread): InlineAIThreadLinks {
  return {
    ...createEmptyInlineAIThreadLinks(),
    ...(thread.links ?? {}),
  };
}

function mergeUnique(existing: string[], incoming?: string[]): string[] {
  if (!incoming || incoming.length === 0) return existing;
  return [...new Set([...existing, ...incoming])];
}
