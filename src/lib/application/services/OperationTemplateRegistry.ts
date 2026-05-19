/**
 * OperationTemplateRegistry - Built-in operation templates
 *
 * Provides pre-configured templates for common AI operations
 * like research, summarization, and review.
 *
 * Part of the Hexagonal Architecture application layer.
 */

import type { OperationTemplate } from '$lib/domain/values/OperationTemplate';

const BUILT_IN_TEMPLATES: OperationTemplate[] = [
  {
    id: 'research-topic',
    name: 'Research Topic',
    description: 'Research a topic using notes as context. Creates a comprehensive note with references.',
    type: 'session',
    promptTemplate: 'Research {{topic}} using my existing notes as context. Create a comprehensive note with references to relevant existing notes.',
    contextRequirements: [
      { type: 'search', query: '{{topic}}', limit: 10 },
      { type: 'recentNotes', limit: 5 },
    ],
    resultHandling: {
      autoApply: false,
      previewRequired: true,
      createNote: true,
      updateExisting: false,
    },
    variables: [
      { name: 'topic', description: 'The topic to research', type: 'string', required: true },
    ],
    estimatedDuration: 30000,
  },
  {
    id: 'summarize-folder',
    name: 'Summarize Folder',
    description: 'Summarize all notes in a folder into a single overview note.',
    type: 'single',
    promptTemplate: 'Summarize all notes in the folder "{{folder}}". Create a comprehensive overview.',
    contextRequirements: [
      { type: 'folder', folder: '{{folder}}' },
    ],
    resultHandling: {
      autoApply: false,
      previewRequired: true,
      createNote: true,
      updateExisting: false,
    },
    variables: [
      { name: 'folder', description: 'Folder path to summarize', type: 'string', required: true },
    ],
    estimatedDuration: 20000,
  },
  {
    id: 'rewrite-section',
    name: 'Rewrite Section',
    description: 'Rewrite selected text with specific instructions.',
    type: 'single',
    promptTemplate: 'Rewrite the following text according to these instructions: {{instructions}}\n\nText to rewrite:\n{{text}}',
    contextRequirements: [
      { type: 'currentNote' },
    ],
    resultHandling: {
      autoApply: false,
      previewRequired: true,
      createNote: false,
      updateExisting: true,
    },
    variables: [
      { name: 'instructions', description: 'How to rewrite the text', type: 'string', required: true },
      { name: 'text', description: 'The text to rewrite', type: 'string', required: true },
    ],
    estimatedDuration: 10000,
  },
  {
    id: 'extract-all-todos',
    name: 'Extract All TODOs',
    description: 'Extract todos from all notes into a single summary.',
    type: 'batch',
    promptTemplate: 'Extract and organize all TODOs, action items, and tasks from all notes.',
    contextRequirements: [
      { type: 'allNotes' },
    ],
    resultHandling: {
      autoApply: false,
      previewRequired: true,
      createNote: true,
      updateExisting: false,
    },
    variables: [],
    estimatedDuration: 25000,
  },
  {
    id: 'daily-review',
    name: 'Daily Review',
    description: 'Generate a daily summary from recent notes.',
    type: 'single',
    promptTemplate: 'Generate a daily review and summary based on my recent notes. Highlight key points, decisions, and next steps.',
    contextRequirements: [
      { type: 'recentNotes', limit: 10 },
    ],
    resultHandling: {
      autoApply: false,
      previewRequired: true,
      createNote: true,
      updateExisting: false,
    },
    variables: [],
    estimatedDuration: 15000,
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm',
    description: 'Brainstorm about a topic with AI as a thinking partner.',
    type: 'session',
    promptTemplate: 'Let\'s brainstorm about {{topic}}. Use my existing notes for context and help me explore new angles.',
    contextRequirements: [
      { type: 'currentNote' },
      { type: 'search', query: '{{topic}}', limit: 5 },
    ],
    resultHandling: {
      autoApply: false,
      previewRequired: true,
      createNote: true,
      updateExisting: false,
    },
    variables: [
      { name: 'topic', description: 'The topic to brainstorm about', type: 'string', required: true },
    ],
    estimatedDuration: 30000,
  },
];

export class OperationTemplateRegistry {
  #templates: Map<string, OperationTemplate>;

  constructor() {
    this.#templates = new Map(BUILT_IN_TEMPLATES.map((t) => [t.id, t]));
  }

  getAll(): OperationTemplate[] {
    return Array.from(this.#templates.values());
  }

  get(id: string): OperationTemplate | null {
    return this.#templates.get(id) ?? null;
  }

  register(template: OperationTemplate): void {
    this.#templates.set(template.id, template);
  }
}
