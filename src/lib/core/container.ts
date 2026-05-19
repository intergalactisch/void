/**
 * Lightweight Dependency Injection Container using symbols for type safety.
 * Services are registered with factories and resolved lazily.
 */

type Factory<T> = () => T;

/**
 * Optional teardown contract. Any cached singleton that implements
 * `dispose()` will have it called when the container is disposed —
 * useful for closing watchers, clearing intervals, and aborting AI
 * processes during hot reload or sign-out.
 */
export interface Disposable {
  dispose(): void | Promise<void>;
}

function isDisposable(value: unknown): value is Disposable {
  return (
    typeof value === 'object' &&
    value !== null &&
    'dispose' in value &&
    typeof (value as { dispose: unknown }).dispose === 'function'
  );
}

/**
 * DI Container for managing service dependencies.
 *
 * Usage:
 * ```typescript
 * const container = new Container();
 * container.register(TOKENS.FileSystem, () => new TauriFileSystemAdapter());
 * const fs = container.resolve<FileSystemPort>(TOKENS.FileSystem);
 * ```
 */
export class Container {
  private registry = new Map<symbol, Factory<unknown>>();
  private instances = new Map<symbol, unknown>();
  private singletons = new Set<symbol>();

  /**
   * Register a service factory
   * @param token - Symbol identifier for the service
   * @param factory - Factory function that creates the service instance
   * @param singleton - If true (default), the instance is cached after first resolution
   */
  register<T>(token: symbol, factory: Factory<T>, singleton = true): void {
    this.registry.set(token, factory);
    if (singleton) {
      this.singletons.add(token);
    }
    // Clear cached instance if re-registering
    this.instances.delete(token);
  }

  /**
   * Resolve a service by its token
   * @throws Error if no provider is registered for the token
   */
  resolve<T>(token: symbol): T {
    // Return cached singleton instance
    if (this.singletons.has(token) && this.instances.has(token)) {
      return this.instances.get(token) as T;
    }

    const factory = this.registry.get(token);
    if (!factory) {
      throw new Error(`No provider registered for ${token.toString()}`);
    }

    const instance = factory() as T;

    // Cache singleton instances
    if (this.singletons.has(token)) {
      this.instances.set(token, instance);
    }

    return instance;
  }

  /**
   * Check if a service is registered
   */
  has(token: symbol): boolean {
    return this.registry.has(token);
  }

  /**
   * Clear all registrations and cached instances (useful for testing)
   */
  clear(): void {
    this.registry.clear();
    this.instances.clear();
    this.singletons.clear();
  }

  /**
   * Clear only cached instances, keeping registrations (useful for testing)
   */
  clearInstances(): void {
    this.instances.clear();
  }

  /**
   * Dispose every cached singleton that implements `Disposable`, then
   * clear caches and registrations. Long-running adapters (file watchers,
   * loggers, AI processes) get a chance to release resources cleanly.
   *
   * Errors from individual `dispose()` calls are caught and rethrown as
   * an AggregateError so one bad disposer can't mask the others.
   */
  async dispose(): Promise<void> {
    const errors: unknown[] = [];

    for (const instance of this.instances.values()) {
      if (isDisposable(instance)) {
        try {
          await instance.dispose();
        } catch (e) {
          errors.push(e);
        }
      }
    }

    this.instances.clear();
    this.registry.clear();
    this.singletons.clear();

    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} disposers failed`);
    }
  }
}

/**
 * Service tokens for dependency injection.
 * Use these symbols when registering and resolving services.
 *
 * Outbound ports (infrastructure interfaces):
 * - FileSystem: File system operations
 * - SettingsStorage: Settings persistence
 * - CredentialStorage: Secure credential storage
 * - DocumentStorage: Document persistence (markdown)
 * - Editor: ProseMirror editor
 * - CommandRegistry: Slash command registry
 * - AIProvider: AI text operations
 * - ToolRegistry: Tool definition storage
 * - ToolExecutor: Tool execution
 * - ContextProvider: Application context gathering
 * - AIAssistantProvider: AI assistant provider
 * - TodoParser: Markdown todo parsing
 * - TodoRepository: Todo storage operations
 * - TodoWatcher: File system watching for todos
 *
 * Inbound ports (application services):
 * - SettingsService: Settings management
 * - FileService: File operations
 * - CredentialService: Credential management
 * - EditorService: Editor orchestration
 * - CommandService: Command palette
 * - AIRewriteService: AI text rewriting
 * - ToolRegistryService: Tool management service
 * - AIAssistantService: AI assistant service
 * - TodoService: TODO management service
 */
export const TOKENS = {
  // Outbound ports (infrastructure)
  // Using Symbol.for() ensures the same symbol is returned across module instances
  // This prevents issues with dynamic imports or bundler chunking creating different symbols
  FileSystem: Symbol.for('void:FileSystem'),
  SettingsStorage: Symbol.for('void:SettingsStorage'),
  CredentialStorage: Symbol.for('void:CredentialStorage'),
  DocumentStorage: Symbol.for('void:DocumentStorage'),
  EditorPortFactory: Symbol.for('void:EditorPortFactory'),
  ExternalNavigation: Symbol.for('void:ExternalNavigation'),
  CommandRegistry: Symbol.for('void:CommandRegistry'),
  AIProvider: Symbol.for('void:AIProvider'),

  // AI Assistant outbound ports
  ToolRegistry: Symbol.for('void:ToolRegistry'),
  ToolExecutor: Symbol.for('void:ToolExecutor'),
  ContextProvider: Symbol.for('void:ContextProvider'),
  AIAssistantProvider: Symbol.for('void:AIAssistantProvider'),
  AgentRunStorage: Symbol.for('void:AgentRunStorage'),
  SessionStorage: Symbol.for('void:SessionStorage'),
  AgentEventStream: Symbol.for('void:AgentEventStream'),
  ResearchSource: Symbol.for('void:ResearchSource'),
  MediaSource: Symbol.for('void:MediaSource'),
  WebFetch: Symbol.for('void:WebFetch'),
  ApplicationNavigation: Symbol.for('void:ApplicationNavigation'),

  // Markdown serializer port
  MarkdownSerializer: Symbol.for('void:MarkdownSerializer'),

  // TODO system outbound ports
  TodoParser: Symbol.for('void:TodoParser'),
  TodoRepository: Symbol.for('void:TodoRepository'),
  TodoWatcher: Symbol.for('void:TodoWatcher'),

  // Inbound ports (application services)
  SettingsService: Symbol.for('void:SettingsService'),
  FileService: Symbol.for('void:FileService'),
  CredentialService: Symbol.for('void:CredentialService'),
  EditorService: Symbol.for('void:EditorService'),
  CommandService: Symbol.for('void:CommandService'),
  AIRewriteService: Symbol.for('void:AIRewriteService'),

  // AI Assistant inbound services
  ToolRegistryService: Symbol.for('void:ToolRegistryService'),
  AIAssistantService: Symbol.for('void:AIAssistantService'),

  // TODO inbound service
  TodoService: Symbol.for('void:TodoService'),

  // Notes inbound service
  NotesService: Symbol.for('void:NotesService'),

  // Document inbound service (headless content API for AI tools)
  DocumentService: Symbol.for('void:DocumentService'),

  // Active editor / AI collaboration service
  NoteCollaborationService: Symbol.for('void:NoteCollaborationService'),

  // Operation system
  OperationService: Symbol.for('void:OperationService'),
  OperationStorage: Symbol.for('void:OperationStorage'),
  CLISessionManager: Symbol.for('void:CLISessionManager'),
  CLIProvider: Symbol.for('void:CLIProvider'),
  ContextBuilder: Symbol.for('void:ContextBuilder'),
  ResultParser: Symbol.for('void:ResultParser'),

  // Logging
  Logger: Symbol.for('void:Logger'),

  // Command bus
  CommandBus: Symbol.for('void:CommandBus'),

  // Conversation persistence
  ConversationStorage: Symbol.for('void:ConversationStorage'),

  // Artifact system
  VoidStorage: Symbol.for('void:VoidStorage'),
  LineageStorage: Symbol.for('void:LineageStorage'),
  ProvenanceService: Symbol.for('void:ProvenanceService'),
  SessionService: Symbol.for('void:SessionService'),
  LineageService: Symbol.for('void:LineageService'),
  CommitmentLineageService: Symbol.for('void:CommitmentLineageService'),
  IndexService: Symbol.for('void:IndexService'),
  BranchService: Symbol.for('void:BranchService'),
  PulseService: Symbol.for('void:PulseService'),

  // Operation pipeline
  OperationRunner: Symbol.for('void:OperationRunner'),

  // Agent loop
  AgentLoopService: Symbol.for('void:AgentLoopService'),
  AgentOrchestrationService: Symbol.for('void:AgentOrchestrationService'),
  AgentIntakeService: Symbol.for('void:AgentIntakeService'),
  AgentSwarmPlanner: Symbol.for('void:AgentSwarmPlanner'),
  AgentWorkerRunner: Symbol.for('void:AgentWorkerRunner'),
  AgentWorkerBus: Symbol.for('void:AgentWorkerBus'),
  AgentWorkerScheduler: Symbol.for('void:AgentWorkerScheduler'),
  AgentMergeService: Symbol.for('void:AgentMergeService'),
  ScopedWorkerToolExecutor: Symbol.for('void:ScopedWorkerToolExecutor'),
  DeepResearchEvidence: Symbol.for('void:DeepResearchEvidence'),
  DeepResearchPipeline: Symbol.for('void:DeepResearchPipeline'),
  PhaseNarrator: Symbol.for('void:PhaseNarrator'),

  // Keymap (power-user shortcut layer)
  KeymapService: Symbol.for('void:KeymapService'),
  KeymapStorage: Symbol.for('void:KeymapStorage'),

  // Search
  SearchService: Symbol.for('void:SearchService'),
  ContentSearch: Symbol.for('void:ContentSearch'),

  // Relations (backlinks / outgoing links)
  RelationsService: Symbol.for('void:RelationsService'),

  // Frecency (recency × frequency)
  FrecencyService: Symbol.for('void:FrecencyService'),

  // RefIds for AI-addressable app objects
  ReferenceService: Symbol.for('void:ReferenceService'),

  // Sidebar navigation preferences
  SidebarPreferencesService: Symbol.for('void:SidebarPreferencesService'),

  // Action history (global undo for destructive ops)
  ActionHistoryService: Symbol.for('void:ActionHistoryService'),

  // Clipboard history
  ClipboardService: Symbol.for('void:ClipboardService'),
  ClipboardWatcher: Symbol.for('void:ClipboardWatcher'),
  ClipboardWriter: Symbol.for('void:ClipboardWriter'),

  // Global quick-capture
  CaptureService: Symbol.for('void:CaptureService'),

  // Auto-updater
  Updater: Symbol.for('void:Updater'),
  UpdaterService: Symbol.for('void:UpdaterService'),
} as const;

/**
 * Type for TOKENS keys
 */
export type TokenKey = keyof typeof TOKENS;
