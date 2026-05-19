import type { IntentFrame, LineActor } from '$lib/domain/entities/Lineage';
import type { ToolServices } from '$lib/ports/inbound/ToolServices';
import { normalizeNotePath } from '../note/paths';

export async function resolveLineageNoteId(
  noteId: string | undefined,
  services: ToolServices,
): Promise<string> {
  const selected = noteId ?? services.notes.getSelectedPath();
  if (!selected) {
    throw new Error('No note selected. Provide noteId or open a note first.');
  }
  return noteId ? normalizeNotePath(noteId, services) : selected;
}

export function toZeroBasedLine(line: number): number {
  if (!Number.isInteger(line) || line < 1) {
    throw new Error('Line must be a 1-based positive integer');
  }
  return line - 1;
}

export function actorLabel(actor: LineActor): string {
  const base = actor.kind === 'ai-agent' ? 'AI agent' : actor.kind.replace(/-/g, ' ');
  if (actor.name) return `${base} (${actor.name})`;
  if (actor.model) return `${base} (${actor.model})`;
  return base;
}

export function intentLabel(intent: IntentFrame | null | undefined): string {
  if (!intent) return 'unknown intent';
  return intent.summary || intent.kind.replace(/-/g, ' ');
}
