import { err, ok, type Result } from '$lib/core';
import type {
  AIAssistantService,
  InlineAIThreadService,
  LineageService,
  NoteAIActivity,
  NoteAIActivityItem,
  NoteAIActivityService,
  ProvenanceService,
} from '$lib/ports/inbound';
import type { LineageTimelineEntry } from '$lib/ports/inbound/LineageService';
import type { InlineAIThread } from '$lib/domain/entities/InlineAIThread';
import type { ProvenanceEvent } from '$lib/domain/values/ProvenanceEvent';
import { noteNameFromPath } from '$lib/domain/values/VoidPath';

export class NoteAIActivityServiceImpl implements NoteAIActivityService {
  constructor(
    private readonly inlineAI: InlineAIThreadService,
    private readonly aiAssistant: AIAssistantService,
    private readonly provenance: ProvenanceService,
    private readonly lineage: LineageService,
  ) {}

  async loadForNote(notePath: string): Promise<Result<NoteAIActivity, Error>> {
    try {
      const threadsResult = await this.inlineAI.loadForDocument(notePath);
      if (!threadsResult.ok) return err(threadsResult.error);

      const conversations = await this.aiAssistant.loadDocumentConversations(notePath);
      const provenanceResult = await this.provenance.getHistory(noteNameFromPath(notePath));
      if (!provenanceResult.ok) return err(provenanceResult.error);

      const lineageResult = await this.lineage.getTimeline(notePath, { limit: 160 });
      if (!lineageResult.ok) return err(lineageResult.error);

      const conversationById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
      const provenanceEvents = provenanceResult.value;
      const lineageEntries = lineageResult.value.entries;
      const items = threadsResult.value
        .map((thread) => buildActivityItem(
          notePath,
          thread,
          conversationById,
          provenanceEvents,
          lineageEntries,
        ))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

      return ok({
        notePath,
        items,
        conversations,
        provenanceEvents,
        lineageEntries,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function buildActivityItem(
  notePath: string,
  thread: InlineAIThread,
  conversationById: Map<string, NoteAIActivityItem['conversation']>,
  provenanceEvents: ProvenanceEvent[],
  lineageEntries: LineageTimelineEntry[],
): NoteAIActivityItem {
  const latest = thread.turns.at(-1);
  const conversation = thread.conversationId ? conversationById.get(thread.conversationId) ?? null : null;
  const linkedProvenance = provenanceEvents.filter((event) => provenanceMatchesThread(event, thread));
  const linkedLineage = lineageEntries.filter((entry) => lineageMatchesThread(entry, thread, linkedProvenance));
  const prompt = latest?.prompt ?? thread.invocation.prompt;

  return {
    id: thread.id,
    notePath,
    thread,
    conversation,
    conversationId: thread.conversationId,
    status: thread.status,
    prompt,
    responsePreview: latest?.response ?? '',
    invokedAt: thread.invocation.createdAt,
    updatedAt: thread.updatedAt,
    invokedLocation: describeInvocation(thread),
    selectedText: thread.invocation.selectedText || thread.anchor.selectedText,
    contextBefore: thread.invocation.beforeText || thread.anchor.beforeText,
    contextAfter: thread.invocation.afterText || thread.anchor.afterText,
    changeCount: linkedLineage.reduce((sum, entry) => sum + entry.diffHunks.length, thread.proposal?.changes.length ?? 0),
    accepted: thread.status === 'applied' || thread.proposal?.status === 'accepted',
    proposalState: thread.proposal?.status ?? null,
    provenanceEvents: linkedProvenance,
    lineageEntries: linkedLineage,
    events: thread.events ?? [],
  };
}

function provenanceMatchesThread(event: ProvenanceEvent, thread: InlineAIThread): boolean {
  if (event.inlineThreadId === thread.id || event.receiptId === thread.id) return true;
  if (thread.conversationId && event.conversationId === thread.conversationId) return true;
  return thread.links?.provenanceEventIds?.includes(event.id) ?? false;
}

function lineageMatchesThread(
  entry: LineageTimelineEntry,
  thread: InlineAIThread,
  provenanceEvents: ProvenanceEvent[],
): boolean {
  if ('isPending' in entry && entry.isPending) return false;
  const receiptId = entry.receiptId ?? entry.intent?.receiptId;
  if (receiptId === thread.id) return true;
  if (entry.clusterId && thread.links?.lineageClusterIds?.includes(entry.clusterId)) return true;
  const provenanceIds = new Set(provenanceEvents.map((event) => event.id));
  if (entry.provenanceEventId && provenanceIds.has(entry.provenanceEventId)) return true;
  return false;
}

function describeInvocation(thread: InlineAIThread): string {
  const range = thread.invocation.range;
  if (range) return `Selection ${range.from}-${range.to}`;
  if (thread.invocation.blockIds.length === 1) return 'One block';
  if (thread.invocation.blockIds.length > 1) return `${thread.invocation.blockIds.length} blocks`;
  return 'Inline note';
}
