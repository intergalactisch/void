/**
 * ContextProviderAdapter - Implementation of ContextProviderPort
 *
 * Gathers application context from various stores and services to provide
 * context for AI prompts. Falls back to empty/default context if stores
 * are not initialized.
 *
 * This adapter acts as a bridge between the application stores (editor, settings)
 * and the AI assistant service which needs context for prompts.
 *
 * Part of Hexagonal Architecture - implements the ContextProviderPort interface.
 */

import type { ContextProviderPort } from '$lib/ports/outbound/ContextProviderPort';
import type {
  PromptContext,
  EditorContext,
  NavigationContext,
  NoteSummary,
} from '$lib/domain/values/PromptContext';
import { createEmptyContext, createNoteSummary } from '$lib/domain/values/PromptContext';
import type { Document } from '$lib/domain/entities/Document';
import type { EditorService } from '$lib/ports/inbound/EditorService';
import type { Selection } from '$lib/domain/values/Selection';
import { isCollapsed } from '$lib/domain/values/Selection';

/**
 * Configuration for the context provider adapter.
 */
export interface ContextProviderConfig {
  /** Default language if not auto-detected */
  defaultLanguage?: string;
  /** Maximum number of recent notes to track */
  maxRecentNotes?: number;
}

/**
 * Context provider adapter that gathers context from stores.
 *
 * @example
 * ```typescript
 * const contextProvider = new ContextProviderAdapter({
 *   defaultLanguage: 'en',
 *   maxRecentNotes: 10,
 * });
 *
 * // Set editor service reference after bootstrap
 * contextProvider.setEditorService(editorService);
 *
 * // Get full context for AI prompt
 * const context = await contextProvider.getContext();
 * ```
 */
export class ContextProviderAdapter implements ContextProviderPort {
  private readonly config: Required<ContextProviderConfig>;
  private editorService: EditorService | null = null;
  private currentDocument: Document | null = null;
  private notesBasePath: string = '';
  private recentNotes: NoteSummary[] = [];
  private currentView: NavigationContext['currentView'] = 'editor';
  private navigationHistory: string[] = [];
  private navigationIndex = -1;
  private subscribers: Set<(context: PromptContext) => void> = new Set();

  constructor(config: ContextProviderConfig = {}) {
    this.config = {
      defaultLanguage: config.defaultLanguage ?? 'en',
      maxRecentNotes: config.maxRecentNotes ?? 10,
    };
  }

  /**
   * Set the editor service reference.
   * Call this after the editor service is bootstrapped.
   */
  setEditorService(service: EditorService): void {
    this.editorService = service;
  }

  /**
   * Set the notes base path for resolving relative document paths.
   * Called during bootstrap with the user's configured notes directory.
   */
  setNotesBasePath(path: string): void {
    this.notesBasePath = path;
  }

  /**
   * Set the currently open document.
   * Called from the UI when the active document changes.
   */
  setCurrentDocument(doc: Document | null): void {
    this.currentDocument = doc;
    if (doc) {
      this.trackNoteAccess(doc);
    }
    this.notifySubscribers();
  }

  /**
   * Get the notes base path.
   */
  getNotesBasePath(): string {
    return this.notesBasePath;
  }

  /**
   * Track a note access for recent notes list.
   */
  trackNoteAccess(document: Document): void {
    const summary = createNoteSummary(document);

    // Remove existing entry for this note
    this.recentNotes = this.recentNotes.filter((n) => n.path !== summary.path);

    // Add to front
    this.recentNotes.unshift(summary);

    // Trim to max size
    if (this.recentNotes.length > this.config.maxRecentNotes) {
      this.recentNotes = this.recentNotes.slice(0, this.config.maxRecentNotes);
    }

    // Notify subscribers of context change
    this.notifySubscribers();
  }

  /**
   * Set the current view.
   */
  setCurrentView(view: NavigationContext['currentView']): void {
    this.currentView = view;

    // Track navigation history
    this.navigationHistory = this.navigationHistory.slice(0, this.navigationIndex + 1);
    this.navigationHistory.push(view);
    this.navigationIndex = this.navigationHistory.length - 1;

    this.notifySubscribers();
  }

  /**
   * Navigate back in history.
   */
  goBack(): NavigationContext['currentView'] | null {
    if (this.navigationIndex > 0) {
      this.navigationIndex--;
      this.currentView = this.navigationHistory[this.navigationIndex] as NavigationContext['currentView'];
      this.notifySubscribers();
      return this.currentView;
    }
    return null;
  }

  /**
   * Navigate forward in history.
   */
  goForward(): NavigationContext['currentView'] | null {
    if (this.navigationIndex < this.navigationHistory.length - 1) {
      this.navigationIndex++;
      this.currentView = this.navigationHistory[this.navigationIndex] as NavigationContext['currentView'];
      this.notifySubscribers();
      return this.currentView;
    }
    return null;
  }

  // =========================================================================
  // ContextProviderPort implementation
  // =========================================================================

  async getContext(): Promise<PromptContext> {
    const currentNote = await this.getCurrentDocument();
    const editor = await this.getEditorContext();
    const navigation = await this.getNavigationContext();
    const recentNotes = await this.getRecentNotes();

    return {
      currentNote,
      editor,
      recentNotes,
      navigation,
      timezone: this.getTimezone(),
      language: this.getLanguage(),
      intent: currentNote?.meta.intent ?? null,
      artifactMemory: [],
      references: [],
      capturedAt: new Date(),
    };
  }

  async getCurrentDocument(): Promise<Document | null> {
    if (this.editorService) {
      const state = this.editorService.getState();
      if (state.document) {
        return state.document;
      }
    }

    if (this.currentDocument) {
      return this.currentDocument;
    }

    return null;
  }

  async getEditorContext(): Promise<EditorContext | null> {
    if (!this.editorService) {
      return null;
    }

    const state = this.editorService.getState();

    if (!state.document) {
      return null;
    }

    const selection = this.editorService.getSelection();
    const selectedText = this.getSelectedText(state.document, selection);

    // Count words in document
    const wordCount = state.document.blocks.reduce((count, block) => {
      if (block.content) {
        return count + block.content.split(/\s+/).filter((w) => w.length > 0).length;
      }
      return count;
    }, 0);

    // Determine current block type
    let currentBlockType: string | undefined;
    if (selection && !isCollapsed(selection)) {
      const currentBlock = state.document.blocks.find((block) => {
        // Simple heuristic - would need more sophisticated logic in real implementation
        return true;
      });
      if (currentBlock) {
        currentBlockType = currentBlock.type;
      }
    }

    const context: EditorContext = {
      isActive: state.isReady,
      selection,
      selectedText,
      wordCount,
    };

    if (currentBlockType !== undefined) {
      context.currentBlockType = currentBlockType;
    }

    return context;
  }

  async getNavigationContext(): Promise<NavigationContext> {
    return {
      currentView: this.currentView,
      canGoBack: this.navigationIndex > 0,
      canGoForward: this.navigationIndex < this.navigationHistory.length - 1,
    };
  }

  async getRecentNotes(limit?: number): Promise<NoteSummary[]> {
    const max = limit ?? this.config.maxRecentNotes;
    return this.recentNotes.slice(0, max);
  }

  getLanguage(): string {
    // Try to get from browser
    if (typeof navigator !== 'undefined' && navigator.language) {
      return navigator.language;
    }
    return this.config.defaultLanguage;
  }

  getTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
    }
  }

  subscribe(callback: (context: PromptContext) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  // =========================================================================
  // Private methods
  // =========================================================================

  /**
   * Get selected text from document based on selection.
   */
  private getSelectedText(document: Document, selection: Selection): string {
    if (!selection || isCollapsed(selection)) {
      return '';
    }

    // Return the text property from selection if available
    if (selection.text) {
      return selection.text;
    }

    // For now, return empty - would need actual implementation based on
    // how selection maps to document content
    // This would require integration with the editor adapter
    return '';
  }

  /**
   * Notify all subscribers of context change.
   */
  private async notifySubscribers(): Promise<void> {
    const context = await this.getContext();
    for (const callback of this.subscribers) {
      try {
        callback(context);
      } catch (error) {
        console.error('Error in ContextProvider subscriber:', error);
      }
    }
  }

  // =========================================================================
  // Testing utilities
  // =========================================================================

  /**
   * Clear recent notes (for testing).
   */
  clearRecentNotes(): void {
    this.recentNotes = [];
  }

  /**
   * Reset navigation history (for testing).
   */
  resetNavigation(): void {
    this.navigationHistory = [];
    this.navigationIndex = -1;
    this.currentView = 'editor';
  }
}
