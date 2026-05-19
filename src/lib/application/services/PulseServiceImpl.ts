/**
 * PulseServiceImpl - Implementation of PulseService
 *
 * Runs background analysis to surface proactive insights.
 * Uses VoidStoragePort for persistence and NotesService for note access.
 *
 * Part of Hexagonal Architecture application layer.
 */

import { ok, err } from '$lib/core';
import type { Result } from '$lib/core/result';
import type { PulseService } from '$lib/ports/inbound/PulseService';
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';
import type { NotesService, NotesListItem } from '$lib/ports/inbound/NotesService';
import type { TodoService } from '$lib/ports/inbound/TodoService';
import type { Insight } from '$lib/domain/entities/Insight';
import { createInsight, dismissInsight } from '$lib/domain/entities/Insight';
import { insightsPath } from '$lib/domain/values/VoidPath';
import { events } from '$lib/events';

const INSIGHTS_FILE = 'pending.json';

export class PulseServiceImpl implements PulseService {
  constructor(
    private readonly voidStorage: VoidStoragePort,
    private readonly notesService: NotesService,
    private readonly todoService: TodoService,
    private readonly notesPath: string
  ) {}

  async analyze(): Promise<Result<Insight[], Error>> {
    try {
      const newInsights: Insight[] = [];

      // Check for overdue todos
      const overdueInsights = await this.checkOverdueTodos();
      newInsights.push(...overdueInsights);

      // Check for stale notes
      const staleInsights = await this.checkStaleNotes();
      newInsights.push(...staleInsights);

      if (newInsights.length > 0) {
        // Load existing insights and merge
        const existing = await this.loadInsights();
        const merged = this.mergeInsights(existing, newInsights);
        await this.saveInsights(merged);

        events.emit('pulse:new-insight', { count: newInsights.length });
      }

      return ok(newInsights);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async analyzeNote(_noteName: string): Promise<Result<Insight[], Error>> {
    // For MVP, delegate to full analyze
    // In future: targeted analysis for just this note
    return this.analyze();
  }

  async getInsights(): Promise<Result<Insight[], Error>> {
    try {
      const insights = await this.loadInsights();
      const pending = insights.filter((i) => !i.dismissed);
      return ok(pending);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async getInsightCount(): Promise<Result<number, Error>> {
    const result = await this.getInsights();
    if (!result.ok) return result;
    return ok(result.value.length);
  }

  async dismiss(insightId: string): Promise<Result<void, Error>> {
    try {
      const insights = await this.loadInsights();
      const updated = insights.map((i) =>
        i.id === insightId ? dismissInsight(i) : i
      );
      await this.saveInsights(updated);

      events.emit('pulse:dismissed', { insightId });
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async dismissAll(): Promise<Result<void, Error>> {
    try {
      const insights = await this.loadInsights();
      const updated = insights.map((i) => dismissInsight(i));
      await this.saveInsights(updated);
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // =========================================================================
  // Analysis checks
  // =========================================================================

  private async checkOverdueTodos(): Promise<Insight[]> {
    const insights: Insight[] = [];

    try {
      const todosResult = await this.todoService.getAll();
      if (!todosResult.ok) return insights;

      const todos = todosResult.value;
      const now = new Date();
      let overdueCount = 0;

      for (const todo of todos) {
        if (!todo.isCompleted && todo.dates.dueDate) {
          if (todo.dates.dueDate < now) {
            overdueCount++;
          }
        }
      }

      if (overdueCount > 0) {
        insights.push(createInsight({
          type: 'overdue',
          title: `${overdueCount} overdue action item${overdueCount > 1 ? 's' : ''}`,
          message: `You have ${overdueCount} action item${overdueCount > 1 ? 's' : ''} past their due date.`,
          sourceNote: '_todos',
        }));
      }
    } catch {
      // Todo service may not be available
    }

    return insights;
  }

  private async checkStaleNotes(): Promise<Insight[]> {
    const insights: Insight[] = [];
    const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const notesState = this.notesService.getState();
    const allNotes: NotesListItem[] = [];
    function flatten(items: NotesListItem[]) {
      for (const item of items) {
        if (!item.isFolder) allNotes.push(item);
        if (item.children) flatten(item.children);
      }
    }
    flatten(notesState.items);

    for (const note of allNotes.slice(0, 50)) {
      if (note.modifiedAt) {
        const modifiedTime = note.modifiedAt.getTime();
        if (now - modifiedTime > TWO_WEEKS_MS) {
          insights.push(createInsight({
            type: 'stale',
            title: `"${note.title}" hasn't been touched`,
            message: `You haven't edited "${note.title}" in over 2 weeks.`,
            sourceNote: note.path,
          }));
        }
      }
    }

    // Limit stale insights to top 5
    return insights.slice(0, 5);
  }

  // =========================================================================
  // Persistence
  // =========================================================================

  private async loadInsights(): Promise<Insight[]> {
    const path = `${insightsPath()}/${INSIGHTS_FILE}`;
    const result = await this.voidStorage.readJson<Insight[]>(this.notesPath, path);
    if (!result.ok || !result.value) return [];
    return result.value;
  }

  private async saveInsights(insights: Insight[]): Promise<void> {
    const path = `${insightsPath()}/${INSIGHTS_FILE}`;
    await this.voidStorage.writeJson(this.notesPath, path, insights);
  }

  /**
   * Merge new insights with existing ones, avoiding duplicates.
   * A duplicate has the same type + sourceNote + relatedNote.
   */
  private mergeInsights(existing: Insight[], newInsights: Insight[]): Insight[] {
    const merged = [...existing];

    for (const insight of newInsights) {
      const isDuplicate = existing.some(
        (e) =>
          !e.dismissed &&
          e.type === insight.type &&
          e.sourceNote === insight.sourceNote &&
          e.relatedNote === insight.relatedNote
      );

      if (!isDuplicate) {
        merged.push(insight);
      }
    }

    return merged;
  }
}
