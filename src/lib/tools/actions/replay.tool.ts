import { defineTool } from '../define';
import { aiPrompt } from '../context';
import type { ProvenanceEvent } from '$lib/domain/values/ProvenanceEvent';
import { isAIEvent } from '$lib/domain/values/ProvenanceEvent';
import { noteNameFromPath } from '$lib/domain/values/VoidPath';

export default defineTool({
  id: 'action:replay',
  name: 'Replay',
  description: 'Generate a narrated timeline of how this document evolved',
  category: 'intelligence',
  keywords: ['replay', 'history', 'timeline', 'evolution', 'story'],
  examples: ['Replay this note', 'Show the history', 'How did this document evolve?'],
  estimatedDuration: 12000,
  accessMode: 'read',

  async execute(_args, { services, progress }) {
    progress(10, 'Reading document...');
    const state = services.editor.getState();
    const doc = state.document;
    if (!doc) throw new Error('No document open');

    const noteName = noteNameFromPath(doc.path);
    const content = doc.blocks.map((b) => b.content).join('\n');

    progress(30, 'Loading interaction history...');

    // Read provenance events from .void/ via file operations
    // Since tools don't have direct access to ProvenanceService,
    // we read through the documents service pattern
    const provenanceContent = await services.files.read(
      `.void/provenance/${noteName}.jsonl`
    );

    let events: ProvenanceEvent[] = [];
    if (provenanceContent.ok && provenanceContent.value) {
      const lines = provenanceContent.value.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        try {
          events.push(JSON.parse(line) as ProvenanceEvent);
        } catch {
          // Skip malformed lines
        }
      }
    }

    if (events.length === 0) {
      throw new Error('No interaction history found for this note. Use AI features to build history.');
    }

    // Filter to significant events
    const significant = events.filter(
      (e) => isAIEvent(e) || (e.type === 'user_edit' && e.diff && (e.diff.added + e.diff.removed) > 10)
    );

    progress(60, 'Generating narrative...');

    const eventSummaries = significant.map((e) => {
      const date = new Date(e.ts).toLocaleDateString();
      const time = new Date(e.ts).toLocaleTimeString();
      let desc = `[${date} ${time}] ${e.type}`;
      if (e.prompt) desc += `: "${e.prompt}"`;
      if (e.action) desc += `: ${e.action}`;
      if (e.accepted !== undefined) desc += e.accepted ? ' (accepted)' : ' (rejected)';
      if (e.diff) desc += ` (+${e.diff.added}/-${e.diff.removed} lines)`;
      return desc;
    });

    const result = await aiPrompt(services,
      `Generate a narrated timeline of how this document evolved. Tell the story of its creation and revision — when it was created, what AI interactions shaped it, what the author changed, and how the thinking evolved.

Document title: ${doc.meta.title ?? noteName}
Current content (first 500 chars): ${content.slice(0, 500)}

Interaction history (chronological):
${eventSummaries.join('\n')}

Write in second person ("You created...", "You asked the AI to..."). Be specific and reference actual events. Keep it concise — one paragraph per significant milestone.`
    );

    progress(80, 'Creating replay note...');
    await services.collaboration.createNote({
      title: `Replay — ${noteName}`,
      content: result,
      autoFocus: true,
    });

    progress(100, 'Done');
    return { replayed: true, noteName, eventCount: significant.length };
  },

  summary: (_args, result) => {
    const r = result as { noteName?: string; eventCount?: number };
    return `Created replay for "${r.noteName}" with ${r.eventCount} events`;
  },
});
