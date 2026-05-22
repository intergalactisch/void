/**
 * InlineAIThreadService - inbound port for persisted inline AI responses.
 */

import type { Result } from '$lib/core';
import type {
  InlineAIInvocationEntryPoint,
  InlineAIThread,
} from '$lib/domain/entities/InlineAIThread';

export interface InlineAISelectionPromptInput {
  prompt: string;
  selectionText: string;
  notePath: string;
  from: number | null;
  to: number | null;
  blockIds: string[];
  entryPoint?: InlineAIInvocationEntryPoint;
}

export interface InlineAIThreadService {
  loadForDocument(notePath: string): Promise<Result<InlineAIThread[], Error>>;

  getThreads(notePath?: string | null): InlineAIThread[];

  subscribe(callback: (threads: InlineAIThread[]) => void): () => void;

  submitSelectionPrompt(input: InlineAISelectionPromptInput): Promise<Result<InlineAIThread, Error>>;

  retryThread(threadId: string): Promise<Result<InlineAIThread, Error>>;

  followUp(threadId: string, prompt: string): Promise<Result<InlineAIThread, Error>>;

  acceptProposal(threadId: string): Promise<Result<InlineAIThread, Error>>;

  cancelProposal(threadId: string): Promise<Result<InlineAIThread, Error>>;

  dismissThread(threadId: string): Promise<Result<InlineAIThread, Error>>;

  markSeen(threadId: string): Promise<Result<InlineAIThread, Error>>;
}
