/**
 * Operations Store - Primary Adapter
 *
 * Svelte 5 store connecting UI to the OperationService.
 * Provides reactive state for active operations, sessions,
 * queue status, and result management.
 *
 * Part of Hexagonal Architecture primary adapters layer.
 */

import { toError } from '$lib/core';
import type {
  OperationService,
  OperationRequest,
  OperationSummary,
  OperationSummaryQuery,
  QueueStatus,
  OperationStateChange,
} from '$lib/ports/inbound/OperationService';
import type { PagedResult } from '$lib/ports/outbound/PagedQuery';
import type { Operation } from '$lib/domain/entities/Operation';
import type { OperationId } from '$lib/domain/values/OperationId';
import type { SessionId } from '$lib/domain/values/SessionId';
import type { OperationTemplate, ContextRequirement } from '$lib/domain/values/OperationTemplate';
import { isSessionOperation } from '$lib/domain/entities/Operation';
import { isTerminalStatus } from '$lib/domain/values/OperationStatus';
import { events } from '$lib/events';

/**
 * Operations Store class with reactive state using Svelte 5 runes.
 */
class OperationsStore {
  #service: OperationService | null = null;
  #unsubscribe: (() => void) | null = null;
  #knownCompletedIds = new Set<string>();
  /**
   * Flag used to distinguish the very first state delivery (which carries
   * persisted operations from a previous session) from subsequent updates.
   * On the initial delivery we seed `#knownCompletedIds` without emitting
   * `operation:completed` — otherwise every persisted-completed op would
   * trigger a duplicate toast every time the app boots.
   */
  #seededFromPersistence = false;

  // Reactive state
  operations = $state<Operation[]>([]);
  queueStatus = $state<QueueStatus | null>(null);
  selectedOperation = $state<Operation | null>(null);
  error = $state<Error | null>(null);
  panelOpen = $state(false);
  operationSummaryPage = $state<PagedResult<OperationSummary>>({
    items: [],
    nextCursor: null,
    total: null,
  });

  // Derived state
  get activeOperations(): Operation[] {
    return this.operations.filter((op) => !isTerminalStatus(op.status));
  }

  get completedOperations(): Operation[] {
    return this.operations.filter((op) => op.status === 'completed');
  }

  get unappliedResultOperations(): Operation[] {
    return this.operations
      .filter((op) => op.status === 'completed' && !!op.result && op.result.outputs.length > 0)
      .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
  }

  get sessions(): Operation[] {
    return this.operations.filter(isSessionOperation);
  }

  get historyOperations(): Operation[] {
    return this.operations
      .filter((op) => isTerminalStatus(op.status))
      .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
  }

  /**
   * Initialize the store with an OperationService.
   */
  init(service: OperationService) {
    this.#cleanup();
    this.#service = service;

    this.#unsubscribe = service.subscribe((state: OperationStateChange) => {
      if (!this.#seededFromPersistence) {
        // First delivery happens after `service.initialize()` finishes
        // loading persisted operations. Treat it as a snapshot of prior
        // state — record the completed IDs so future diffs can recognise
        // them, but do NOT emit `operation:completed`. Otherwise every
        // app boot would re-toast every previously completed run.
        for (const op of state.operations) {
          if (op.status === 'completed') {
            this.#knownCompletedIds.add(op.id);
          }
        }
        this.#seededFromPersistence = true;
      } else {
        // Diff against known set — only toast for genuinely new completions
        // that finished during this session.
        for (const op of state.operations) {
          if (op.status === 'completed' && !this.#knownCompletedIds.has(op.id)) {
            this.#knownCompletedIds.add(op.id);
            events.emit('operation:completed', { operationId: op.id });
          }
        }
      }

      this.operations = state.operations;
      this.queueStatus = state.queueStatus;
    });

    this.queueStatus = service.getQueueStatus();
  }

  /**
   * Load persisted operations from disk. The subscribe callback in
   * `init()` handles seeding `#knownCompletedIds` from the first state
   * delivery, so no extra seeding is needed here.
   */
  async load(): Promise<void> {
    if (!this.#service) return;
    await this.#service.initialize();
  }

  // =========================================================================
  // Queue operations
  // =========================================================================

  async queue(request: OperationRequest): Promise<Operation | null> {
    if (!this.#service) throw new Error('OperationsStore not initialized');

    this.error = null;
    const result = await this.#service.queue(request);
    if (result.ok) {
      return result.value;
    } else {
      this.error = result.error;
      return null;
    }
  }

  async queueFromTemplate(
    templateId: string,
    variables: Record<string, string | number | boolean>
  ): Promise<Operation | null> {
    if (!this.#service) throw new Error('OperationsStore not initialized');

    this.error = null;
    const result = await this.#service.queueFromTemplate(templateId, variables);
    if (result.ok) {
      return result.value;
    } else {
      this.error = result.error;
      return null;
    }
  }

  // =========================================================================
  // Session management
  // =========================================================================

  async startSession(
    name: string,
    initialPrompt: string,
    contextRequirements?: ContextRequirement[]
  ): Promise<Operation | null> {
    if (!this.#service) throw new Error('OperationsStore not initialized');

    this.error = null;
    const result = await this.#service.startSession(name, initialPrompt, contextRequirements);
    if (result.ok) {
      return result.value;
    } else {
      this.error = result.error;
      return null;
    }
  }

  async resumeSession(sessionId: SessionId, prompt: string): Promise<Operation | null> {
    if (!this.#service) throw new Error('OperationsStore not initialized');

    this.error = null;
    const result = await this.#service.resumeSession(sessionId, prompt);
    if (result.ok) {
      return result.value;
    } else {
      this.error = result.error;
      return null;
    }
  }

  // =========================================================================
  // Result handling
  // =========================================================================

  async applyResult(operationId: OperationId): Promise<void> {
    if (!this.#service) throw new Error('OperationsStore not initialized');

    try {
      const result = await this.#service.applyResult(operationId);
      if (!result.ok) {
        this.error = result.error;
      }
    } catch (e) {
      this.error = toError(e);
    }
  }

  discardResult(operationId: OperationId): void {
    if (!this.#service) return;
    this.#service.discardResult(operationId);
  }

  async cancel(operationId: OperationId): Promise<void> {
    if (!this.#service) return;

    try {
      const result = await this.#service.cancel(operationId);
      if (!result.ok) {
        this.error = result.error;
      }
    } catch (e) {
      this.error = toError(e);
    }
  }

  // =========================================================================
  // History
  // =========================================================================

  async clearHistory(): Promise<void> {
    if (!this.#service) return;

    try {
      const result = await this.#service.clearHistory();
      if (!result.ok) {
        this.error = result.error;
      }
    } catch (e) {
      this.error = toError(e);
    }
  }

  async loadOperationSummaries(query?: OperationSummaryQuery): Promise<PagedResult<OperationSummary>> {
    if (!this.#service) {
      this.operationSummaryPage = { items: [], nextCursor: null, total: 0 };
      return this.operationSummaryPage;
    }
    const result = await this.#service.listOperationSummaries(query);
    if (!result.ok) {
      this.error = result.error;
      return this.operationSummaryPage;
    }
    this.operationSummaryPage = result.value;
    return result.value;
  }

  /**
   * Persist any running operations (called on app close).
   */
  async persistRunningOperations(): Promise<void> {
    if (!this.#service) return;
    await this.#service.persistRunningOperations();
  }

  // =========================================================================
  // Templates
  // =========================================================================

  getTemplates(): OperationTemplate[] {
    return this.#service?.getTemplates() ?? [];
  }

  getTemplate(id: string): OperationTemplate | null {
    return this.#service?.getTemplate(id) ?? null;
  }

  // =========================================================================
  // Selection
  // =========================================================================

  selectOperation(operationId: OperationId): void {
    this.selectedOperation = this.#service?.getOperation(operationId) ?? null;
  }

  clearSelection(): void {
    this.selectedOperation = null;
  }

  // =========================================================================
  // Panel state
  // =========================================================================

  togglePanel(): void {
    this.panelOpen = !this.panelOpen;
  }

  openPanel(): void {
    this.panelOpen = true;
  }

  closePanel(): void {
    this.panelOpen = false;
    this.selectedOperation = null;
  }

  // =========================================================================
  // Store state
  // =========================================================================

  get isInitialized(): boolean {
    return this.#service !== null;
  }

  get hasActiveOperations(): boolean {
    return this.activeOperations.length > 0;
  }

  // =========================================================================
  // Private methods
  // =========================================================================

  #cleanup() {
    if (this.#unsubscribe) {
      this.#unsubscribe();
      this.#unsubscribe = null;
    }
  }

  destroy() {
    this.#cleanup();
    this.#service = null;
    this.operations = [];
    this.queueStatus = null;
    this.selectedOperation = null;
    this.error = null;
    this.panelOpen = false;
    this.#knownCompletedIds.clear();
    this.#seededFromPersistence = false;
  }
}

export const operationsStore = new OperationsStore();
