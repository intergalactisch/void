/**
 * NoteAIActivityService - read model for note-bound AI conversations.
 */

import type { Result } from '$lib/core';
import type { Conversation } from '$lib/domain/entities/Conversation';
import type {
  InlineAIThread,
  InlineAIThreadEvent,
  InlineAIThreadStatus,
} from '$lib/domain/entities/InlineAIThread';
import type { ProvenanceEvent } from '$lib/domain/values/ProvenanceEvent';
import type { LineageTimelineEntry } from './LineageService';

export interface NoteAIActivity {
  notePath: string;
  items: NoteAIActivityItem[];
  conversations: Conversation[];
  provenanceEvents: ProvenanceEvent[];
  lineageEntries: LineageTimelineEntry[];
}

export interface NoteAIActivityItem {
  id: string;
  notePath: string;
  thread: InlineAIThread;
  conversation: Conversation | null;
  conversationId: string | null;
  status: InlineAIThreadStatus;
  prompt: string;
  responsePreview: string;
  invokedAt: string;
  updatedAt: string;
  invokedLocation: string;
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
  changeCount: number;
  accepted: boolean;
  proposalState: string | null;
  provenanceEvents: ProvenanceEvent[];
  lineageEntries: LineageTimelineEntry[];
  events: InlineAIThreadEvent[];
}

export interface NoteAIActivityService {
  loadForNote(notePath: string): Promise<Result<NoteAIActivity, Error>>;
}
