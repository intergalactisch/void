/**
 * PromptContext - Application context for AI prompts
 *
 * Captures the current state of the application to provide context
 * for AI prompts. This allows the AI to understand what the user
 * is working on and provide relevant responses.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

import type { Document } from '../entities/Document';
import type { Selection } from './Selection';
import type { NoteIntent } from './NoteIntent';
import type { RefId, RefIdKind } from './RefId';

/**
 * Summary of a note for context (lighter than full Document).
 */
export interface NoteSummary {
  /** Note path/id */
  path: string;
  /** Note title */
  title: string;
  /** Preview of content (first ~100 chars) */
  preview: string;
  /** When note was last modified */
  modifiedAt: Date;
  /** Word count */
  wordCount: number;
}

/**
 * Current editor state for context.
 */
export interface EditorContext {
  /** Whether editor is active/focused */
  isActive: boolean;
  /** Current selection */
  selection: Selection;
  /** Selected text content */
  selectedText: string;
  /** Current block type (if cursor in a block) */
  currentBlockType?: string;
  /** Word count of current document */
  wordCount: number;
}

/**
 * Navigation context.
 */
export interface NavigationContext {
  /** Current view/route */
  currentView: 'editor' | 'list' | 'search' | 'settings' | 'other';
  /** Can navigate back */
  canGoBack: boolean;
  /** Can navigate forward */
  canGoForward: boolean;
  /** Breadcrumb path if applicable */
  breadcrumbs?: string[];
}

/**
 * AI-ready resolution of a copied Void RefId.
 */
export interface ResolvedPromptReference {
  /** Original copied RefId string */
  refId: RefId;
  /** RefId kind */
  kind: RefIdKind;
  /** Whether the referenced object was found and current */
  status: 'resolved' | 'unresolved' | 'stale';
  /** Human-readable label/title */
  label: string;
  /** Short summary suitable for prompt context */
  summary: string;
  /** Bounded content/excerpt when useful */
  content?: string;
  /** Small structured facts for tools and model routing */
  metadata?: Record<string, string | number | boolean | string[] | null>;
  /** Explanation when unresolved or stale */
  reason?: string;
}

/**
 * Full context provided to AI for understanding the user's situation.
 */
export interface PromptContext {
  /** Currently open note (if any) */
  currentNote: Document | null;

  /** Editor state (if editor is open) */
  editor: EditorContext | null;

  /** Recently accessed notes for broader context */
  recentNotes: NoteSummary[];

  /** Navigation state */
  navigation: NavigationContext;

  /** User's timezone for time-aware responses */
  timezone: string;

  /** User's preferred language (for responses) */
  language: string;

  /** Document intent for AI behavior adaptation */
  intent: NoteIntent | null;

  /** Artifact memory — summaries of past AI interactions with this document */
  artifactMemory: string[];

  /** Explicit RefIds pasted into the current prompt, resolved for AI use */
  references: ResolvedPromptReference[];

  /** Timestamp when context was captured */
  capturedAt: Date;
}

/**
 * Create an empty/default prompt context.
 */
export function createEmptyContext(): PromptContext {
  return {
    currentNote: null,
    editor: null,
    recentNotes: [],
    navigation: {
      currentView: 'editor',
      canGoBack: false,
      canGoForward: false,
    },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator?.language ?? 'en',
    intent: null,
    artifactMemory: [],
    references: [],
    capturedAt: new Date(),
  };
}

/**
 * Create a context from the current application state.
 */
export function createPromptContext(params: {
  currentNote?: Document | null;
  editor?: EditorContext | null;
  recentNotes?: NoteSummary[];
  navigation?: Partial<NavigationContext>;
  language?: string;
  intent?: NoteIntent | null;
  artifactMemory?: string[];
  references?: ResolvedPromptReference[];
}): PromptContext {
  const navigation: NavigationContext = {
    currentView: params.navigation?.currentView ?? 'editor',
    canGoBack: params.navigation?.canGoBack ?? false,
    canGoForward: params.navigation?.canGoForward ?? false,
  };

  if (params.navigation?.breadcrumbs !== undefined) {
    navigation.breadcrumbs = params.navigation.breadcrumbs;
  }

  return {
    currentNote: params.currentNote ?? null,
    editor: params.editor ?? null,
    recentNotes: params.recentNotes ?? [],
    navigation,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: params.language ?? navigator?.language ?? 'en',
    intent: params.intent ?? null,
    artifactMemory: params.artifactMemory ?? [],
    references: params.references ?? [],
    capturedAt: new Date(),
  };
}

/**
 * Create a note summary from a full document.
 */
export function createNoteSummary(doc: Document): NoteSummary {
  // Get first paragraph content as preview
  const firstBlock = doc.blocks.find(b => b.type === 'paragraph' && b.content);
  const preview = firstBlock?.content?.slice(0, 100) ?? '';

  // Count words across all blocks
  const wordCount = doc.blocks.reduce((count, block) => {
    if (block.content) {
      return count + block.content.split(/\s+/).filter(w => w.length > 0).length;
    }
    return count;
  }, 0);

  return {
    path: doc.path,
    title: doc.meta.title,
    preview: preview.length === 100 ? preview + '...' : preview,
    modifiedAt: doc.meta.updatedAt,
    wordCount,
  };
}

/**
 * Serialize context to a string for AI consumption.
 * This creates a human-readable summary of the context.
 */
export function serializeContext(context: PromptContext): string {
  const parts: string[] = [];

  // Current note
  if (context.currentNote) {
    parts.push(`Current Note: "${context.currentNote.meta.title}"`);

    if (context.editor?.selectedText) {
      parts.push(`Selected Text: "${context.editor.selectedText}"`);
    }

    if (context.editor) {
      parts.push(`Word Count: ${context.editor.wordCount}`);
    }
  } else {
    parts.push('No note currently open');
  }

  // Recent notes
  if (context.recentNotes.length > 0) {
    const recentTitles = context.recentNotes.slice(0, 5).map(n => n.title);
    parts.push(`Recent Notes: ${recentTitles.join(', ')}`);
  }

  // Intent
  if (context.intent) {
    parts.push(`Document Intent: ${context.intent}`);
  }

  // Artifact memory
  if (context.artifactMemory.length > 0) {
    parts.push('');
    parts.push('## Artifact Memory');
    parts.push('Previous interactions with this document:');
    for (const memory of context.artifactMemory) {
      parts.push(`- ${memory}`);
    }
  }

  if (context.references.length > 0) {
    parts.push('');
    parts.push('## Explicit References');
    parts.push('The user pasted these Void RefIds. Treat them as concrete targets and do not guess alternate objects.');
    for (const reference of context.references) {
      parts.push(`- ${reference.refId} [${reference.status}] ${reference.label}: ${reference.summary}`);
      if (reference.content) {
        parts.push(`  Content: ${reference.content}`);
      }
      if (reference.reason) {
        parts.push(`  Reason: ${reference.reason}`);
      }
    }
  }

  // View
  parts.push(`Current View: ${context.navigation.currentView}`);

  // Time context
  parts.push(`User Timezone: ${context.timezone}`);
  parts.push(`User Language: ${context.language}`);

  return parts.join('\n');
}
