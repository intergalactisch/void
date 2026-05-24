import { defineTool } from '../define';
import { aiPrompt } from '../context';
import type { NotesListItem } from '$lib/ports/inbound/NotesService';
import { assertProtectedAIReadAllowed, assertProtectedAIWriteAllowed } from '../protectionGuard';

export default defineTool({
  id: 'action:bridge',
  name: 'Bridge',
  description: 'Find connections between the current note and other notes — explains why they connect',
  category: 'intelligence',
  keywords: ['bridge', 'connect', 'related', 'link', 'connections'],
  examples: ['Find connections', 'What connects to this note?', 'Show bridges'],
  estimatedDuration: 10000,
  accessMode: 'read',

  async execute(_args, { services, progress }) {
    progress(10, 'Reading current note...');
    const state = services.editor.getState();
    const currentPath = state.document?.path ?? '';
    await assertProtectedAIReadAllowed(services, currentPath, 'note.read');
    await assertProtectedAIWriteAllowed(services, currentPath);
    const content = state.document?.blocks.map(b => b.content).join('\n') ?? '';
    const title = state.document?.meta.title ?? '';

    if (!content.trim()) throw new Error('No note open to find bridges for');

    progress(30, 'Listing all notes...');
    const notesState = services.notes.getState();

    const allNotes: Array<{ path: string; title: string }> = [];
    function flatten(items: NotesListItem[]) {
      for (const item of items) {
        if (!item.isFolder) {
          allNotes.push({ path: item.path, title: item.title });
        }
        if (item.children) flatten(item.children);
      }
    }
    flatten(notesState.items);

    if (allNotes.length <= 1) {
      return { bridges: [], message: 'Not enough notes to find connections' };
    }

    // Read a sample of other notes for comparison
    progress(50, 'Reading notes for comparison...');
    const otherNotes = allNotes
      .filter(n => n.path !== state.document?.path)
      .slice(0, 15);

    const summaries: string[] = [];
    const contextPaths: string[] = [];
    for (const note of otherNotes) {
      try {
        await assertProtectedAIReadAllowed(services, note.path, 'related.read');
      } catch {
        continue;
      }
      const noteContent = await services.documents.readContent(note.path);
      if (noteContent.ok) {
        summaries.push(`"${note.title}" (${note.path}): ${noteContent.value.slice(0, 200)}`);
        contextPaths.push(note.path);
      }
    }

    progress(70, 'Analyzing connections...');
    const result = await aiPrompt(services,
      `Given the current note "${title}" with content:\n\n${content.slice(0, 800)}\n\nFind which of these other notes connect to it and explain WHY they connect (not just that they match). Be specific about the connection.\n\nReturn markdown with each connection as:\n## [Note Title]\n**Connection:** explanation of why they connect\n**Shared themes:** list of overlapping topics\n\nOther notes:\n${summaries.join('\n')}`
    );

    progress(90, 'Inserting bridges...');
    const currentContent = await services.documents.readContent(currentPath);
    if (currentContent.ok && state.document) {
      await services.collaboration.applyNoteContent(
        state.document.path,
        currentContent.value + '\n\n---\n\n# Bridges\n\n' + result,
        'AI bridge',
      );

      if (services.sessions) {
        await services.sessions.create({
          type: 'ai-batch',
          kind: 'bridge',
          title: `Bridge — ${state.document.meta.title || state.document.path}`,
          toolId: 'action:bridge',
          createdBy: 'ai-agent',
          members: [
            { notePath: state.document.path, role: 'source' as const },
            ...contextPaths.map((path) => ({ notePath: path, role: 'context' as const })),
          ],
        });
      }
    }

    progress(100, 'Done');
    return { bridges: true };
  },

  summary: () => 'Found and explained connections to other notes',
});
