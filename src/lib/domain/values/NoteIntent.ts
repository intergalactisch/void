/**
 * NoteIntent - Document intent classification
 *
 * Describes the purpose/type of a note. AI behavior adapts
 * based on the intent — meeting notes get structured differently
 * than journal entries or specifications.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

export const NOTE_INTENTS = [
  'general',
  'meeting-notes',
  'project-plan',
  'blog-post',
  'journal',
  'research',
  'brainstorm',
  'specification',
  'letter',
  'reference',
] as const;

export type NoteIntent = typeof NOTE_INTENTS[number];

/**
 * Human-readable labels for each intent.
 */
export const NOTE_INTENT_LABELS: Record<NoteIntent, string> = {
  'general': 'General',
  'meeting-notes': 'Meeting Notes',
  'project-plan': 'Project Plan',
  'blog-post': 'Blog Post',
  'journal': 'Journal',
  'research': 'Research',
  'brainstorm': 'Brainstorm',
  'specification': 'Specification',
  'letter': 'Letter',
  'reference': 'Reference',
};

/**
 * AI behavior hints per intent.
 * Used to modify system prompts based on document type.
 */
export const INTENT_AI_HINTS: Record<NoteIntent, string> = {
  'general': 'Adapt to the content. No specific behavioral adjustments.',
  'meeting-notes': 'Extract decisions, action items, attendees. Structure chronologically.',
  'project-plan': 'Think about risks, dependencies, milestones. Be precise about scope.',
  'blog-post': 'Consider the reader. Suggest hooks, transitions, conclusions.',
  'journal': 'Be gentle and reflective. Ask questions rather than suggest answers.',
  'research': 'Focus on sources, methodology, and findings. Cite evidence.',
  'brainstorm': 'Be divergent. Offer unexpected connections. Don\'t judge ideas.',
  'specification': 'Be precise and complete. Flag ambiguities. Use formal language.',
  'letter': 'Consider the recipient. Be clear about purpose and ask.',
  'reference': 'Be precise and organized. Optimize for quick lookup.',
};

/**
 * Check if a string is a valid NoteIntent.
 */
export function isValidIntent(value: string): value is NoteIntent {
  return NOTE_INTENTS.includes(value as NoteIntent);
}
