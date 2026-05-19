/**
 * OperationServiceImpl - AI operation orchestration service
 *
 * Manages the operation queue, concurrent execution, session management,
 * result handling, and persistence. Coordinates between CLI, context,
 * parsing, and storage.
 *
 * CLI-agnostic: uses CLIProviderPort to build args and parse output.
 *
 * Part of the Hexagonal Architecture application layer.
 */

import { ok, err, type Result } from '$lib/core/result';
import type {
  OperationService,
  OperationRequest,
  OperationSessionOptions,
  QueueStatus,
  OperationStateChange,
} from '$lib/ports/inbound/OperationService';
import type { DocumentService } from '$lib/ports/inbound/DocumentService';
import type { NoteCollaborationService } from '$lib/ports/inbound/NoteCollaborationService';
import type { TodoService } from '$lib/ports/inbound/TodoService';
import type { CLISessionManagerPort } from '$lib/ports/outbound/CLISessionManagerPort';
import type { ContextBuilderPort } from '$lib/ports/outbound/ContextBuilderPort';
import type { ResultParserPort } from '$lib/ports/outbound/ResultParserPort';
import type { OperationStoragePort } from '$lib/ports/outbound/OperationStoragePort';
import type { CLIProviderPort } from '$lib/ports/outbound/CLIProviderPort';
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';
import type { Operation, SessionOperation } from '$lib/domain/entities/Operation';
import { OperationArchiver } from './OperationArchiver';
import { CLIProcessEventRouter } from './CLIProcessEventRouter';
import {
  createOperation,
  createSessionOperation,
  queueOperation,
  startOperation,
  failOperation,
  cancelOperation,
  isSessionOperation,
} from '$lib/domain/entities/Operation';
import type { OperationId } from '$lib/domain/values/OperationId';
import type { SessionId } from '$lib/domain/values/SessionId';
import { isTerminalStatus } from '$lib/domain/values/OperationStatus';
import type { OperationTemplate, ContextRequirement } from '$lib/domain/values/OperationTemplate';
import { renderPromptTemplate } from '$lib/domain/values/OperationTemplate';
import type { OperationOutput } from '$lib/domain/values/OperationResult';
import { OperationTemplateRegistry } from './OperationTemplateRegistry';

/** Maximum number of operations to retain on disk */
const RETENTION_LIMIT = 100;

/** Tools allowed inside the notes folder sandbox */
const SANDBOXED_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];

export class OperationServiceImpl implements OperationService {
  #cliManager: CLISessionManagerPort;
  #provider: CLIProviderPort;
  #contextBuilder: ContextBuilderPort;
  #resultParser: ResultParserPort;
  #storage: OperationStoragePort;
  #voidStorage: VoidStoragePort;
  #documentService: DocumentService;
  #collaborationService: NoteCollaborationService;
  #todoService: TodoService;
  #templateRegistry: OperationTemplateRegistry;
  #archiver: OperationArchiver;
  /** CLI process event routing — owns the process↔operation map. */
  #processEvents: CLIProcessEventRouter;
  #notesPath: string;

  #operations: Map<OperationId, Operation> = new Map();
  #sessions: Map<SessionId, { operationId: OperationId; name: string; lastUsed: Date }> = new Map();
  #queue: OperationId[] = [];
  #concurrencyLimit = 3;
  #subscribers: Set<(state: OperationStateChange) => void> = new Set();

  constructor(
    cliManager: CLISessionManagerPort,
    provider: CLIProviderPort,
    contextBuilder: ContextBuilderPort,
    resultParser: ResultParserPort,
    storage: OperationStoragePort,
    notesPath: string,
    documentService: DocumentService,
    collaborationService: NoteCollaborationService,
    todoService: TodoService,
    voidStorage: VoidStoragePort
  ) {
    this.#cliManager = cliManager;
    this.#provider = provider;
    this.#contextBuilder = contextBuilder;
    this.#resultParser = resultParser;
    this.#storage = storage;
    this.#voidStorage = voidStorage;
    this.#notesPath = notesPath;
    this.#documentService = documentService;
    this.#collaborationService = collaborationService;
    this.#todoService = todoService;
    this.#templateRegistry = new OperationTemplateRegistry();
    this.#archiver = new OperationArchiver({
      documentService,
      voidStorage,
      notesPath,
    });

    // Route CLI process events through the dedicated router. Bridge
    // callbacks point back at this service so the queue scheduling
    // loop and operation-store mutations stay here.
    this.#processEvents = new CLIProcessEventRouter({
      cliManager,
      provider,
      resultParser,
      archiver: this.#archiver,
      templateRegistry: this.#templateRegistry,
      getOperation: (id) => this.#operations.get(id) ?? null,
      updateOperation: (id, op) => this.#operations.set(id, op),
      notify: () => this.#notify(),
      resumeQueue: () => this.#processQueue(),
      persistOperation: (op) => this.#persistOperation(op),
      applyResult: (id) => this.applyResult(id),
    });
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async initialize(): Promise<void> {
    const result = await this.#storage.listAll();
    if (!result.ok) {
      console.warn('[OperationService] Failed to load persisted operations:', result.error);
      return;
    }

    const loaded = result.value;

    // Cancel any operations that were running/queued/pending when app closed
    for (const op of loaded) {
      if (!isTerminalStatus(op.status)) {
        const cancelled = cancelOperation(op);
        const withReason: Operation = {
          ...cancelled,
          result: cancelled.result ?? {
            status: 'cancelled',
            outputs: [],
            rawResponse: '',
            durationMs: op.startedAt ? Date.now() - op.startedAt.getTime() : 0,
            metadata: { reason: 'app_closed' },
          },
        };
        this.#operations.set(op.id, withReason);
        await this.#persistOperation(withReason);
      } else {
        this.#operations.set(op.id, op);
      }
    }

    // Rebuild session mappings from loaded SessionOperations
    for (const op of this.#operations.values()) {
      if (isSessionOperation(op)) {
        this.#sessions.set(op.sessionId, {
          operationId: op.id,
          name: op.sessionName,
          lastUsed: op.completedAt ?? op.createdAt,
        });
      }
    }

    // Apply retention: keep last RETENTION_LIMIT, delete older terminal operations
    await this.#applyRetention();

    this.#notify();
  }

  async persistRunningOperations(): Promise<void> {
    for (const [id, op] of this.#operations) {
      if (!isTerminalStatus(op.status)) {
        const cancelled = cancelOperation(op);
        const withReason: Operation = {
          ...cancelled,
          result: cancelled.result ?? {
            status: 'cancelled',
            outputs: [],
            rawResponse: '',
            durationMs: op.startedAt ? Date.now() - op.startedAt.getTime() : 0,
            metadata: { reason: 'app_closed' },
          },
        };
        this.#operations.set(id, withReason);
        await this.#persistOperation(withReason);
      }
    }
    this.#notify();
  }

  // =========================================================================
  // Queue management
  // =========================================================================

  async queue(request: OperationRequest): Promise<Result<Operation, Error>> {
    try {
      // Build context
      const contextResult = await this.#contextBuilder.buildContext(
        request.contextRequirements ?? []
      );

      const operation = createOperation({
        type: request.type,
        label: request.label,
        prompt: request.prompt,
        context: contextResult.ok ? contextResult.value : null,
        ...(request.targetNotes ? { targetNotes: request.targetNotes } : {}),
        ...(request.templateId ? { templateId: request.templateId } : {}),
        ...(request.webAccess ? { webAccess: request.webAccess } : {}),
      });

      const queued = queueOperation(operation);
      this.#operations.set(queued.id, queued);
      this.#queue.push(queued.id);

      this.#notify();
      this.#processQueue();

      return ok(queued);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async queueFromTemplate(
    templateId: string,
    variables: Record<string, string | number | boolean>
  ): Promise<Result<Operation, Error>> {
    const template = this.#templateRegistry.get(templateId);
    if (!template) {
      return err(new Error(`Template not found: ${templateId}`));
    }

    const prompt = renderPromptTemplate(template.promptTemplate, variables);

    // Interpolate variables in context requirements (e.g. {{topic}} in search query)
    const contextRequirements = template.contextRequirements.map((req) => {
      const interpolated = { ...req };
      if (interpolated.query) {
        interpolated.query = renderPromptTemplate(interpolated.query, variables);
      }
      if (interpolated.folder) {
        interpolated.folder = renderPromptTemplate(interpolated.folder, variables);
      }
      return interpolated;
    });

    return this.queue({
      type: template.type,
      label: template.name,
      prompt,
      contextRequirements,
      templateId,
    });
  }

  async cancel(operationId: OperationId): Promise<Result<void, Error>> {
    const operation = this.#operations.get(operationId);
    if (!operation) {
      return err(new Error(`Operation not found: ${operationId}`));
    }

    // Remove from queue if queued
    this.#queue = this.#queue.filter((id) => id !== operationId);

    // Cancel CLI process if running
    if (operation.status === 'running') {
      const processId = this.#processEvents.findProcessForOperation(operationId);
      if (processId) {
        await this.#cliManager.cancel(processId);
      }
    }

    const cancelled = cancelOperation(operation);
    this.#operations.set(operationId, cancelled);
    this.#notify();
    await this.#persistOperation(cancelled);
    return ok(undefined);
  }

  // =========================================================================
  // Session management
  // =========================================================================

  async startSession(
    name: string,
    initialPrompt: string,
    contextRequirements?: ContextRequirement[],
    options?: OperationSessionOptions
  ): Promise<Result<Operation, Error>> {
    if (!this.#provider.supportsSession) {
      return this.queue({
        type: 'single',
        label: name,
        prompt: initialPrompt,
        ...(contextRequirements ? { contextRequirements } : {}),
        ...(options?.webAccess ? { webAccess: options.webAccess } : {}),
      });
    }

    try {
      const contextResult = await this.#contextBuilder.buildContext(
        contextRequirements ?? []
      );

      const operation = createSessionOperation({
        label: name,
        prompt: initialPrompt,
        sessionName: name,
        context: contextResult.ok ? contextResult.value : null,
        ...(options?.webAccess ? { webAccess: options.webAccess } : {}),
      });

      const queued = queueOperation(operation) as SessionOperation;
      this.#operations.set(queued.id, queued);
      this.#queue.push(queued.id);

      // Store session mapping
      this.#sessions.set(queued.sessionId, {
        operationId: queued.id,
        name,
        lastUsed: new Date(),
      });

      this.#notify();
      this.#processQueue();

      return ok(queued);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async resumeSession(
    sessionId: SessionId,
    prompt: string,
    options?: OperationSessionOptions
  ): Promise<Result<Operation, Error>> {
    if (!this.#provider.supportsResume) {
      return err(new Error(`${this.#provider.displayName} does not support session resume`));
    }

    const session = this.#sessions.get(sessionId);
    if (!session) {
      return err(new Error(`Session not found: ${sessionId}`));
    }

    const operation = createSessionOperation({
      label: `${session.name} (resumed)`,
      prompt,
      sessionName: session.name,
      ...(options?.webAccess ? { webAccess: options.webAccess } : {}),
    });

    // Override sessionId to use existing one
    const sessionOp = operation as SessionOperation;
    (sessionOp as { sessionId: SessionId }).sessionId = sessionId;
    sessionOp.isResumable = true;
    sessionOp.interactionCount += 1;

    const queued = queueOperation(sessionOp);
    this.#operations.set(queued.id, queued);
    this.#queue.push(queued.id);

    session.operationId = queued.id;
    session.lastUsed = new Date();

    this.#notify();
    this.#processQueue();

    return ok(queued);
  }

  // =========================================================================
  // Result handling
  // =========================================================================

  async applyResult(operationId: OperationId): Promise<Result<void, Error>> {
    const operation = this.#operations.get(operationId);
    if (!operation?.result) {
      return err(new Error('Operation has no result to apply'));
    }

    try {
      for (const output of operation.result.outputs) {
        await this.#applyOutput(output, operation);
      }

      // Mark result as applied by clearing it
      const updated = { ...operation, result: null };
      this.#operations.set(operationId, updated);
      this.#notify();
      await this.#persistOperation(updated);
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async #applyOutput(output: OperationOutput, operation: Operation): Promise<void> {
    switch (output.type) {
      case 'content': {
        if (output.targetNote) {
          // Update existing note
          await this.#collaborationService.applyNoteContent(output.targetNote, output.content, operation.label);
        } else {
          // Create new note from content
          const title = operation.label || 'AI Output';
          await this.#collaborationService.createNote({
            title,
            content: output.content,
            autoFocus: true,
          });
        }
        break;
      }
      case 'todo': {
        await this.#todoService.create(output.text, {
          ...(output.targetNote ? { targetFile: output.targetNote } : {}),
        });
        break;
      }
      case 'reference':
      case 'metadata':
        // References and metadata are embedded in content — no separate action needed
        break;
    }
  }

  discardResult(operationId: OperationId): void {
    const operation = this.#operations.get(operationId);
    if (operation?.result) {
      const updated = { ...operation, result: null };
      this.#operations.set(operationId, updated);
      this.#notify();
      this.#persistOperation(updated);
    }
  }

  // =========================================================================
  // Queries
  // =========================================================================

  getOperation(id: OperationId): Operation | null {
    return this.#operations.get(id) ?? null;
  }

  getActiveOperations(): Operation[] {
    return Array.from(this.#operations.values()).filter(
      (op) => op.status === 'running' || op.status === 'queued'
    );
  }

  getCompletedOperations(): Operation[] {
    return Array.from(this.#operations.values()).filter(
      (op) => op.status === 'completed'
    );
  }

  getAllOperations(): Operation[] {
    return Array.from(this.#operations.values());
  }

  getSessions(): Operation[] {
    return Array.from(this.#operations.values()).filter(isSessionOperation);
  }

  getQueueStatus(): QueueStatus {
    return {
      activeCount: this.#cliManager.getActiveCount(),
      queuedCount: this.#queue.length,
      concurrencyLimit: this.#concurrencyLimit,
    };
  }

  // =========================================================================
  // History
  // =========================================================================

  async clearHistory(): Promise<Result<void, Error>> {
    const toDelete: OperationId[] = [];

    for (const [id, op] of this.#operations) {
      if (isTerminalStatus(op.status)) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.#operations.delete(id);
      await this.#storage.delete(id);
    }

    this.#notify();
    return ok(undefined);
  }

  // =========================================================================
  // Templates
  // =========================================================================

  getTemplates(): OperationTemplate[] {
    return this.#templateRegistry.getAll();
  }

  getTemplate(id: string): OperationTemplate | null {
    return this.#templateRegistry.get(id);
  }

  // =========================================================================
  // Subscription
  // =========================================================================

  subscribe(callback: (state: OperationStateChange) => void): () => void {
    this.#subscribers.add(callback);
    return () => {
      this.#subscribers.delete(callback);
    };
  }

  // =========================================================================
  // Private methods
  // =========================================================================

  #notify(): void {
    const state: OperationStateChange = {
      operations: Array.from(this.#operations.values()),
      queueStatus: this.getQueueStatus(),
    };
    for (const sub of this.#subscribers) {
      sub(state);
    }
  }

  async #persistOperation(op: Operation): Promise<void> {
    try {
      await this.#storage.save(op);
    } catch (e) {
      console.warn('[OperationService] Failed to persist operation:', e);
    }
  }

  async #applyRetention(): Promise<void> {
    const allOps = Array.from(this.#operations.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (allOps.length <= RETENTION_LIMIT) return;

    // Keep the most recent RETENTION_LIMIT, delete the rest (only terminal ones)
    const toRemove = allOps.slice(RETENTION_LIMIT);
    for (const op of toRemove) {
      if (isTerminalStatus(op.status)) {
        this.#operations.delete(op.id);
        await this.#storage.delete(op.id);
      }
    }
  }

  #processQueue(): void {
    const activeCount = this.#cliManager.getActiveCount();
    const available = this.#concurrencyLimit - activeCount;

    for (let i = 0; i < available && this.#queue.length > 0; i++) {
      const operationId = this.#queue.shift()!;
      const operation = this.#operations.get(operationId);
      if (operation) {
        this.#executeOperation(operation);
      }
    }
  }

  async #executeOperation(operation: Operation): Promise<void> {
    // Create undo frame before execution (snapshot target notes)
    await this.#archiver.createUndoFrame(operation);

    const started = startOperation(operation);
    this.#operations.set(started.id, started);
    this.#notify();

    try {
      // Build args via provider — all CLI specifics are encapsulated here
      const isResume = isSessionOperation(started) && started.interactionCount > 0;
      const sessionOp = isSessionOperation(started) ? started : null;

      const args = this.#provider.buildArgs({
        prompt: started.prompt,
        ...(started.context?.systemPrompt ? { systemPrompt: started.context.systemPrompt } : {}),
        ...(!isResume && sessionOp ? { sessionId: sessionOp.sessionId } : {}),
        ...(isResume && sessionOp ? { resumeSessionId: sessionOp.sessionId } : {}),
        outputFormat: this.#provider.supportsJsonOutput ? 'json' : 'text',
        ...(this.#provider.supportsToolSandbox ? { allowedTools: SANDBOXED_TOOLS } : {}),
        webAccess: this.#provider.supportsNativeWebSearch ? started.webAccess : 'off',
      });

      const result = await this.#cliManager.spawn({
        operationId: started.id,
        binary: this.#provider.binary,
        args,
        workingDirectory: this.#notesPath,
      });

      if (result.ok) {
        this.#processEvents.bindProcess(result.value.processId, started.id);
      } else {
        const failed = failOperation(started, result.error.message);
        this.#operations.set(started.id, failed);
        this.#notify();
        this.#processQueue();
        await this.#persistOperation(failed);
      }
    } catch (e) {
      const failed = failOperation(started, e instanceof Error ? e.message : String(e));
      this.#operations.set(started.id, failed);
      this.#notify();
      this.#processQueue();
      await this.#persistOperation(failed);
    }
  }

  destroy(): void {
    this.#processEvents.dispose();
  }
}
