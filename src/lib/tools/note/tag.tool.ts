import { defineTool } from '../define';
import { normalizeNoteTags } from '$lib/domain/values';
import { normalizeNotePath } from './paths';

interface TagArgs {
  noteId: string;
  add?: string[];
  remove?: string[];
}

export default defineTool<TagArgs, { success: boolean; added: string[]; removed: string[] }>({
  id: 'note:tag',
  name: 'Tag Note',
  description: 'Add or remove tags from a note',
  category: 'note',

  args: {
    noteId: { type: 'string', description: 'ID of the note to tag', required: true },
    add: { type: 'array', description: 'Tags to add', items: { type: 'string', description: 'Tag name' } },
    remove: { type: 'array', description: 'Tags to remove', items: { type: 'string', description: 'Tag name' } },
  },

  keywords: ['tag', 'label', 'categorize'],
  examples: ['Add tag "work" to this note', 'Remove the "draft" tag', 'Tag as "important"'],
  estimatedDuration: 100,
  resourceId: (args) => args.noteId,
  accessMode: 'write',

  summary: (_args, result) => {
    const parts: string[] = [];
    if (result.added.length) parts.push(`+${result.added.join(', +')}`);
    if (result.removed.length) parts.push(`-${result.removed.join(', -')}`);
    return `Tags: ${parts.join(' ')}`;
  },

  async execute(args, { services, progress, invocation }) {
    progress(10, 'Reading tags...');
    const noteId = await normalizeNotePath(args.noteId, services);

    // Read current metadata
    const metaResult = await services.documents.readMeta(noteId);
    if (!metaResult.ok) {
      throw new Error(`Failed to read note: ${metaResult.error.message}`);
    }

    const currentTags = new Set(normalizeNoteTags(metaResult.value.tags));

    // Apply additions
    const added = normalizeNoteTags(args.add);
    for (const tag of added) {
      currentTags.add(tag);
    }

    // Apply removals
    const removed = normalizeNoteTags(args.remove);
    for (const tag of removed) {
      currentTags.delete(tag);
    }

    progress(50, 'Updating tags...');

    const updateResult = await services.collaboration.updateNote({
      noteId,
      tags: [...currentTags],
      label: 'AI tag update',
      lineage: {
        actor: { kind: 'ai-agent' },
        intentKind: 'rewrite',
        summary: 'AI tag update',
        commandId: 'note:tag',
        ...(invocation.id ? { receiptId: invocation.id } : {}),
        source: { type: 'tool' },
      },
    });
    if (!updateResult.ok) {
      throw new Error(`Failed to update tags: ${updateResult.error.message}`);
    }

    progress(100, 'Tags updated');
    return { success: true, added, removed };
  },
});
