/**
 * Bootstrap - Composition Root
 *
 * This is the ONLY file in the application that knows about concrete
 * adapter implementations. It wires together the entire dependency graph
 * using the DI container.
 *
 * Part of Hexagonal Architecture - this is where ports meet adapters.
 *
 * Usage:
 * ```typescript
 * // In +layout.svelte
 * import { bootstrap } from '$lib';
 *
 * onMount(async () => {
 *   await bootstrap();
 * });
 *
 * // For testing (browser-only dev)
 * await bootstrap({ useMocks: true });
 * ```
 */

import { Container, TOKENS } from './core';
import { events, CommandBus } from './events';
import { OperationRunner } from './pipeline';
import { registerAIAssistantProvider } from './bootstrap/registerAI';
import { registerCLIProvider } from './bootstrap/registerCLI';

// Adapters (infrastructure) - concrete implementations
import {
  TauriFileSystemAdapter,
  TauriSettingsAdapter,
  TauriCredentialAdapter,
  TauriGitRepositoryAdapter,
  TauriGitHubAdapter,
  TauriLoggerAdapter,
  TauriOperationStorageAdapter,
  TauriVoidStorageAdapter,
  TauriConversationAdapter,
  TauriExternalNavigationAdapter,
  TauriWebFetchAdapter,
  TauriClipboardWatcher,
  TauriClipboardWriter,
  TauriUpdaterAdapter,
  MemoryClipboardWatcher,
  MemoryClipboardWriter,
} from './adapters/tauri';
import {
  MemoryFileSystemAdapter,
  MemorySettingsAdapter,
  MemoryCredentialAdapter,
  MemoryGitRepositoryAdapter,
  MemoryGitHubAdapter,
  MemoryLoggerAdapter,
  MemoryOperationStorageAdapter,
  MemoryVoidStorageAdapter,
  MemoryConversationAdapter,
  MemoryExternalNavigationAdapter,
  MemoryAgentRunStorageAdapter,
  MemorySessionStorageAdapter,
  MemoryResearchSourceAdapter,
  MemoryMediaSourceAdapter,
  MemoryWebFetchAdapter,
  MemoryUpdaterAdapter,
} from './adapters/memory';
import {
  VoidAgentRunStorageAdapter,
  VoidSessionStorageAdapter,
  AIAssistedResearchSourceAdapter,
  AIAssistedMediaSourceAdapter,
  EventApplicationNavigationAdapter,
  LocalAgentEventStreamAdapter,
} from './adapters/agent';
import { VoidLineageStorageAdapter } from './adapters/lineage';
import { ProseMirrorEditorPortFactory } from './adapters/prosemirror';
import { MarkdownAdapter, MarkdownSerializerAdapter } from './adapters/markdown';
import { CommandRegistryAdapter, registerGlobalCommands } from './adapters/commands';
import {
  TauriCaptureWindowManager,
  NoopCaptureWindowManager,
  attachCaptureMessageBridge,
  type CaptureWindowManager,
  type CaptureMessageBridge,
} from './adapters/capture';
import { SettingsKeymapStorageAdapter, MemoryKeymapStorageAdapter } from './adapters/keymap';
import { JsContentSearchAdapter, MemoryContentSearchAdapter } from './adapters/search';
import {
  registerScopePredicate,
  defaultEditorFocusedPredicate,
  defaultModalOpenPredicate,
  wireCommandKeybindings,
} from './keymap';
import {
  MockAIAdapter,
  CLIAIAdapter,
  CLISessionManagerAdapter,
  MemoryCLISessionManagerAdapter,
  ResultParserAdapter,
} from './adapters/ai';
import { ConfigurableCLIProvider } from './adapters/cli';

// AI Assistant adapters
import {
  InMemoryToolRegistryAdapter,
  ToolExecutorAdapter,
} from './adapters/tools';

// New modular tool system
import { registerAllTools } from './tools/registry';
import type { ToolServices } from './ports/inbound/ToolServices';
import { ContextProviderAdapter, ContextBuilderAdapter } from './adapters/context';

// TODO adapters
import {
  MarkdownTodoParser,
  MarkdownTodoRepository,
  TauriTodoWatcher,
  MemoryTodoWatcher,
} from './adapters/todo';

// Services (application) - use case implementations
import {
  SettingsServiceImpl,
  WorkspaceServiceImpl,
  FileServiceImpl,
  CredentialServiceImpl,
  SyncServiceImpl,
  EditorServiceImpl,
  CommandServiceImpl,
  KeymapServiceImpl,
  SearchServiceImpl,
  RelationsServiceImpl,
  FrecencyServiceImpl,
  ReferenceServiceImpl,
  SidebarPreferencesServiceImpl,
  ActionHistoryServiceImpl,
  ClipboardServiceImpl,
  type ClipboardWatcher,
  type ClipboardWriter,
  AIRewriteServiceImpl,
  UpdaterServiceImpl,
  ToolRegistryServiceImpl,
  AIAssistantServiceImpl,
  TodoServiceImpl,
  NotesServiceImpl,
  DocumentServiceImpl,
  NoteCollaborationServiceImpl,
  CaptureServiceImpl,
  OperationServiceImpl,
  ProvenanceServiceImpl,
  SessionServiceImpl,
  LineageServiceImpl,
  CommitmentLineageServiceImpl,
  IndexServiceImpl,
  BranchServiceImpl,
  PulseServiceImpl,
  AgentLoopServiceImpl,
  AgentOrchestrationServiceImpl,
  AgentIntakeServiceImpl,
  AgentSwarmPlanner,
  AgentWorkerRunner,
  AgentWorkerBus,
  AgentWorkerScheduler,
  AgentMergeService,
  ScopedWorkerToolExecutor,
  DeepResearchEvidence,
  DeepResearchPipeline,
  PhaseNarrator,
} from './application';
import { AgentRunEngine as AgentRunEngineClass } from './application/services/AgentRunEngine';
import { ConversationStore } from './application/services/ConversationStore';
import { ToolInvocationService } from './application/services/ToolInvocationService';
import { updateMessage } from './domain/entities/Conversation';
import { addToolInvocation, updateToolInvocation } from './domain/entities/Message';

// Stores (UI primary adapters)
import {
  settingsStore,
  workspaceStore,
  aiStore,
  toolStore,
  todoStore,
  notesStore,
  logStore,
  operationsStore,
  filesStore,
  credentialsStore,
  toastStore,
  editorStore,
  commandCenterStore,
  uiStore,
  keymapStore,
  relationsStore,
  provenanceStore,
  lineageStore,
  pulseStore,
  branchesStore,
  clipboardStore,
  sessionsStore,
  syncStore,
} from './stores';

// Logging
import { setLoggerPort, getLogger } from './logging';
import type { LoggerPort } from './ports/outbound/LoggerPort';

// Types
import type {
  SettingsService,
  WorkspaceService,
  FileService,
  CredentialService,
  EditorService,
  CommandService,
  AIRewriteService,
  ToolRegistryService,
  AIAssistantService,
  TodoService,
  NotesService,
  DocumentService,
  CaptureService,
  NoteCollaborationService,
  OperationService,
  ProvenanceService,
  SessionService,
  LineageService,
  CommitmentLineageService,
  IndexService,
  AgentLoopService,
  AgentOrchestrationService,
  AgentIntakeService,
  KeymapService,
  SearchService,
  RelationsService,
  FrecencyService,
  ReferenceService,
  SidebarPreferencesService,
  ActionHistoryService,
  ClipboardService,
  UpdaterService,
  SyncService,
} from './ports/inbound';
import type {
  FileSystemPort,
  DocumentPort,
  CommandRegistryPort,
  AIProviderPort,
  ToolRegistryPort,
  ToolExecutorPort,
  ContextProviderPort,
  AIAssistantProviderPort,
  TodoRepositoryPort,
  TodoWatcherPort,
  SettingsStoragePort,
  CLISessionManagerPort,
  ContextBuilderPort,
  ResultParserPort,
  OperationStoragePort,
  EditorPortFactory,
  ExternalNavigationPort,
  AgentRunStoragePort,
  SessionStoragePort,
  AgentEventStreamPort,
  ResearchSourcePort,
  MediaSourcePort,
  WebFetchPort,
  ApplicationNavigationPort,
  KeymapStoragePort,
  ContentSearchPort,
  GitRepositoryPort,
  GitHubPort,
  LineageStoragePort,
  UpdaterPort,
} from './ports/outbound';
import type { CLIProviderPort } from '$lib/ports/outbound/CLIProviderPort';
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';
import type { MarkdownSerializerPort } from '$lib/ports/outbound/MarkdownSerializerPort';
import type { ConversationStoragePort } from '$lib/ports/outbound/ConversationStoragePort';
import {
  DEFAULT_AI_REASONING_EFFORT,
  type AIReasoningEffort,
  type CLIProviderId,
} from './domain';

/**
 * Application context returned by bootstrap.
 * Provides access to all core services.
 */
export interface AppContext {
  /** DI container for resolving services */
  container: Container;
  /** Settings management service */
  settings: SettingsService;
  /** Multi-workspace management service */
  workspaces: WorkspaceService;
  /** File system operations service */
  files: FileService;
  /** Credential storage service */
  credentials: CredentialService;
  /** Editor orchestration service */
  editor: EditorService;
  /** Command palette service */
  commands: CommandService;
  /** AI text rewriting service */
  aiRewrite: AIRewriteService;
  /** Tool registry service */
  toolRegistry: ToolRegistryService;
  /** AI assistant service */
  aiAssistant: AIAssistantService;
  /** TODO management service */
  todoService: TodoService;
  /** Notes navigation service */
  notesService: NotesService;
  /** AI operation service */
  operationService: OperationService;
  /** Durable agent orchestration service */
  agentOrchestration: AgentOrchestrationService;
  /** Model-led intake service */
  agentIntake: AgentIntakeService;
  /** Keymap service (chord -> commandId resolution). */
  keymap: KeymapService;
  /** Cross-note content search service. */
  search: SearchService;
  /** Backlinks / outgoing links service. */
  relations: RelationsService;
  /** Line-level markdown lineage service. */
  lineage: LineageService;
  /** Frecency tracker for commands and notes. */
  frecency: FrecencyService;
  /** RefId resolution for AI-addressable app objects. */
  references: ReferenceService;
  /** Sidebar favorites and visual folder ordering preferences. */
  sidebarPreferences: SidebarPreferencesService;
  /** Bounded undo stack for destructive global operations. */
  actionHistory: ActionHistoryService;
  /** Clipboard history (in-memory). */
  clipboard: ClipboardService;
  /** Quick-capture orchestrator (inbox / daily). */
  capture: CaptureService;
  /** Window manager + global-shortcut adapter for the capture window. */
  captureManager: CaptureWindowManager;
  /** Auto-update checker (Tauri updater plugin). */
  updater: UpdaterService;
  /** GitHub-backed local-first note sync. */
  sync: SyncService;
}

/**
 * Bootstrap options
 */
export interface BootstrapOptions {
  /**
   * Use mock adapters instead of Tauri adapters.
   * Useful for browser-only development and testing.
   * @default false
   */
  useMocks?: boolean;
  /**
   * Base path for document storage.
   * Required for document operations.
   * @default '~/Documents/void'
   */
  notesPath?: string;
}

/** Track if bootstrap has been called */
let bootstrapped = false;

/** Cached app context for reuse */
let appContext: AppContext | null = null;

/** Disposers for capture-window infrastructure. Cleared by shutdown(). */
let captureDisposers:
  | { manager: CaptureWindowManager; bridge: CaptureMessageBridge | null }
  | null = null;

let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;

function normalizeCLIProvider(value: unknown): CLIProviderId {
  return value === 'claude-code' ? 'claude-code' : 'codex';
}

function normalizeAIReasoningEffort(value: unknown): AIReasoningEffort {
  return (
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
  )
    ? value
    : DEFAULT_AI_REASONING_EFFORT;
}

/**
 * Bootstrap the application.
 *
 * This is the composition root that:
 * 1. Creates the DI container
 * 2. Registers adapters (infrastructure implementations)
 * 3. Registers application services (wired to adapters via ports)
 * 4. Initializes stores (UI primary adapters)
 * 5. Loads initial state
 * 6. Emits app:ready event
 *
 * @param options - Bootstrap options
 * @returns Application context with all services
 */
export async function bootstrap(options?: BootstrapOptions): Promise<AppContext> {
  // Return cached context if already bootstrapped
  if (bootstrapped && appContext) {
    return appContext;
  }

  const container = new Container();
  const useMocks = options?.useMocks ?? false;
  const defaultNotesPath = options?.notesPath ?? '~/Documents/void';

  // 1. Register core adapters first (needed to load settings)
  if (useMocks) {
    container.register(TOKENS.FileSystem, () => new MemoryFileSystemAdapter());
    container.register(TOKENS.SettingsStorage, () => new MemorySettingsAdapter());
    container.register(TOKENS.CredentialStorage, () => new MemoryCredentialAdapter());
  } else {
    container.register(TOKENS.FileSystem, () => new TauriFileSystemAdapter());
    container.register(TOKENS.SettingsStorage, () => new TauriSettingsAdapter());
    container.register(TOKENS.CredentialStorage, () => new TauriCredentialAdapter());
  }

  // Register logger early (right after FileSystem, before settings load)
  if (useMocks) {
    container.register(TOKENS.Logger, () => new MemoryLoggerAdapter());
  } else {
    container.register(TOKENS.Logger, () =>
      new TauriLoggerAdapter(
        container.resolve<FileSystemPort>(TOKENS.FileSystem),
        `~/.void/logs`
      )
    );
  }
  const logger = container.resolve<LoggerPort>(TOKENS.Logger);
  setLoggerPort(logger);
  logStore.init(logger);
  const log = getLogger('Bootstrap');

  // Register settings service early so we can load settings
  container.register(TOKENS.SettingsService, () =>
    new SettingsServiceImpl(container.resolve(TOKENS.SettingsStorage))
  );

  // 2. Load settings to get the user's configured notesPath
  const settingsService = container.resolve<SettingsService>(TOKENS.SettingsService);
  const settingsResult = await settingsService.load();
  const notesPath = settingsResult.ok
    ? settingsResult.value.notesPath || defaultNotesPath
    : defaultNotesPath;
  const cliProviderSetting = normalizeCLIProvider(
    settingsResult.ok ? settingsResult.value.cliProvider : undefined
  );
  const aiReasoningEffort = normalizeAIReasoningEffort(
    settingsResult.ok ? settingsResult.value.aiReasoningEffort : undefined
  );

  // 3. Ensure notes directory exists before loading notes
  const fileSystem = container.resolve<FileSystemPort>(TOKENS.FileSystem);
  const dirResult = await fileSystem.createDirectory(notesPath);
  if (!dirResult.ok) {
    log.error('Failed to create notes directory', { path: notesPath, error: String(dirResult.error) });
  } else {
    log.info('Notes directory ready', { path: notesPath });
  }

  // 3. Register remaining outbound adapters (using loaded notesPath)
  // Register command registry adapter
  container.register(TOKENS.CommandRegistry, () => new CommandRegistryAdapter(true));

  // Register keymap storage + service. The service is pure logic; the
  // storage adapter persists user overrides via SettingsService.
  if (useMocks) {
    container.register(TOKENS.KeymapStorage, () => new MemoryKeymapStorageAdapter());
  } else {
    container.register(TOKENS.KeymapStorage, () =>
      new SettingsKeymapStorageAdapter(container.resolve<SettingsService>(TOKENS.SettingsService))
    );
  }
  container.register(TOKENS.KeymapService, () =>
    new KeymapServiceImpl(container.resolve<KeymapStoragePort>(TOKENS.KeymapStorage))
  );

  // Register content search adapter + service. The JS adapter scans .md
  // files via FileSystemPort; future iterations may swap in a Rust grep.
  if (useMocks) {
    container.register(TOKENS.ContentSearch, () => new MemoryContentSearchAdapter());
  } else {
    container.register(TOKENS.ContentSearch, () =>
      new JsContentSearchAdapter(
        container.resolve<FileSystemPort>(TOKENS.FileSystem),
        container.resolve<NotesService>(TOKENS.NotesService)
      )
    );
  }

  // Register editor factory and external navigation adapters
  container.register(TOKENS.EditorPortFactory, () => new ProseMirrorEditorPortFactory());
  container.register(TOKENS.ExternalNavigation, () =>
    useMocks ? new MemoryExternalNavigationAdapter() : new TauriExternalNavigationAdapter()
  );
  if (useMocks) {
    container.register(TOKENS.GitRepository, () => new MemoryGitRepositoryAdapter());
    container.register(TOKENS.GitHub, () => new MemoryGitHubAdapter());
  } else {
    container.register(TOKENS.GitRepository, () => new TauriGitRepositoryAdapter());
    container.register(TOKENS.GitHub, () => new TauriGitHubAdapter());
  }

  // Register AI provider adapter (mock for now — inline rewrite uses AIProviderPort)
  container.register(TOKENS.AIProvider, () => new MockAIAdapter({ delay: 500 }));

  // Register document storage (markdown adapter) with user's configured path
  container.register(TOKENS.DocumentStorage, () =>
    new MarkdownAdapter(
      container.resolve<FileSystemPort>(TOKENS.FileSystem),
      { basePath: notesPath }
    )
  );

  // Register OperationRunner for tracked multi-step operations (before ToolExecutor)
  container.register(TOKENS.OperationRunner, () => new OperationRunner());

  // Register AI Assistant adapters
  container.register(TOKENS.ToolRegistry, () => new InMemoryToolRegistryAdapter());
  container.register(TOKENS.ToolExecutor, () =>
    new ToolExecutorAdapter(
      container.resolve<OperationRunner>(TOKENS.OperationRunner),
      // Late-binding service factory: resolves at execute time so we observe
      // a fully wired container even though the executor is registered before
      // the application services it ultimately calls.
      (): ToolServices => ({
        notes: container.resolve<NotesService>(TOKENS.NotesService),
        editor: container.resolve<EditorService>(TOKENS.EditorService),
        documents: container.resolve<DocumentService>(TOKENS.DocumentService),
        lineage: container.resolve<LineageService>(TOKENS.LineageService),
        branches: container.resolve<import('./ports/inbound/BranchService').BranchService>(TOKENS.BranchService),
        commitmentLineage: container.resolve<CommitmentLineageService>(TOKENS.CommitmentLineageService),
        collaboration: container.resolve<NoteCollaborationService>(TOKENS.NoteCollaborationService),
        todos: container.resolve<TodoService>(TOKENS.TodoService),
        files: container.resolve<FileService>(TOKENS.FileService),
        ai: container.resolve<AIAssistantProviderPort>(TOKENS.AIAssistantProvider),
        settings: container.resolve<SettingsStoragePort>(TOKENS.SettingsStorage),
        operations: container.resolve<OperationService>(TOKENS.OperationService),
        navigation: container.resolve<ApplicationNavigationPort>(TOKENS.ApplicationNavigation),
        mediaSources: container.resolve<MediaSourcePort>(TOKENS.MediaSource),
        sessions: container.resolve<SessionService>(TOKENS.SessionService),
      })
    )
  );

  // Create context provider and set the notes base path
  const contextProviderAdapter = new ContextProviderAdapter();
  contextProviderAdapter.setNotesBasePath(notesPath);
  container.register(TOKENS.ContextProvider, () => contextProviderAdapter);

  // AI provider setup: extracted to bootstrap/registerAI.ts
  await registerAIAssistantProvider(container, {
    useMocks,
    notesPath,
    cliProviderSetting,
    aiReasoningEffort,
  });

  // Register TODO adapters
  container.register(TOKENS.TodoParser, () => new MarkdownTodoParser());

  container.register(TOKENS.TodoRepository, () =>
    new MarkdownTodoRepository(
      container.resolve<FileSystemPort>(TOKENS.FileSystem),
      container.resolve(TOKENS.TodoParser),
      { notesPath }
    )
  );

  if (useMocks) {
    container.register(TOKENS.TodoWatcher, () => new MemoryTodoWatcher());
  } else {
    container.register(TOKENS.TodoWatcher, () => new TauriTodoWatcher());
  }

  // Register CLI provider (extracted to bootstrap/registerCLI.ts)
  await registerCLIProvider(container, {
    useMocks,
    cliProviderSetting,
    aiReasoningEffort,
  });

  // Register Void storage adapter (Artifact system)
  if (useMocks) {
    container.register(TOKENS.VoidStorage, () => new MemoryVoidStorageAdapter());
  } else {
    container.register(TOKENS.VoidStorage, () => new TauriVoidStorageAdapter());
  }
  container.register(TOKENS.LineageStorage, () =>
    new VoidLineageStorageAdapter(
      container.resolve<VoidStoragePort>(TOKENS.VoidStorage),
      notesPath
    )
  );

  // Register durable agent-run storage and research source lookup
  if (useMocks) {
    container.register(TOKENS.AgentRunStorage, () => new MemoryAgentRunStorageAdapter());
    container.register(TOKENS.SessionStorage, () => new MemorySessionStorageAdapter());
    container.register(TOKENS.WebFetch, () => new MemoryWebFetchAdapter());
    container.register(TOKENS.ResearchSource, () => new MemoryResearchSourceAdapter());
    container.register(TOKENS.MediaSource, () => new MemoryMediaSourceAdapter());
  } else {
    container.register(TOKENS.AgentRunStorage, () =>
      new VoidAgentRunStorageAdapter(
        container.resolve<VoidStoragePort>(TOKENS.VoidStorage),
        notesPath
      )
    );
    container.register(TOKENS.SessionStorage, () =>
      new VoidSessionStorageAdapter(
        container.resolve<VoidStoragePort>(TOKENS.VoidStorage),
        notesPath
      )
    );
    container.register(TOKENS.WebFetch, () => new TauriWebFetchAdapter());
    container.register(TOKENS.ResearchSource, () =>
      new AIAssistedResearchSourceAdapter(
        container.resolve<AIAssistantProviderPort>(TOKENS.AIAssistantProvider),
        container.resolve<ContextProviderPort>(TOKENS.ContextProvider),
        container.resolve<WebFetchPort>(TOKENS.WebFetch)
      )
    );
    container.register(TOKENS.MediaSource, () =>
      new AIAssistedMediaSourceAdapter(
        container.resolve<AIAssistantProviderPort>(TOKENS.AIAssistantProvider),
        container.resolve<ContextProviderPort>(TOKENS.ContextProvider)
      )
    );
  }
  container.register(TOKENS.AgentEventStream, () =>
    new LocalAgentEventStreamAdapter(
      container.resolve<AgentRunStoragePort>(TOKENS.AgentRunStorage)
    )
  );

  // Register Conversation storage adapter
  if (useMocks) {
    container.register(TOKENS.ConversationStorage, () => new MemoryConversationAdapter());
  } else {
    container.register(TOKENS.ConversationStorage, () => new TauriConversationAdapter(notesPath));
  }

  // Register Operation system adapters
  if (useMocks) {
    container.register(TOKENS.CLISessionManager, () => new MemoryCLISessionManagerAdapter());
    container.register(TOKENS.OperationStorage, () => new MemoryOperationStorageAdapter());
  } else {
    container.register(TOKENS.CLISessionManager, () => new CLISessionManagerAdapter());
    container.register(TOKENS.OperationStorage, () => new TauriOperationStorageAdapter(notesPath));
  }
  container.register(TOKENS.ResultParser, () => new ResultParserAdapter());

  // 4. Register remaining application services (wired to ports via container)
  // Note: SettingsService was registered earlier to load settings
  container.register(TOKENS.FileService, () =>
    new FileServiceImpl(container.resolve(TOKENS.FileSystem))
  );
  container.register(TOKENS.CredentialService, () =>
    new CredentialServiceImpl(container.resolve(TOKENS.CredentialStorage))
  );

  // Register editor-related services
  container.register(TOKENS.EditorService, () =>
    new EditorServiceImpl(
      container.resolve<DocumentPort>(TOKENS.DocumentStorage),
      container.resolve<CommandRegistryPort>(TOKENS.CommandRegistry),
      container.resolve<EditorPortFactory>(TOKENS.EditorPortFactory),
      container.resolve<ExternalNavigationPort>(TOKENS.ExternalNavigation),
      container.resolve<AIAssistantService>(TOKENS.AIAssistantService),
      container.resolve<TodoService>(TOKENS.TodoService),
      container.resolve<NotesService>(TOKENS.NotesService),
      notesPath,
      container.resolve<MarkdownSerializerPort>(TOKENS.MarkdownSerializer),
      container.resolve<LineageService>(TOKENS.LineageService),
      container.resolve<FrecencyService>(TOKENS.FrecencyService)
    )
  );
  container.register(TOKENS.CommandService, () =>
    new CommandServiceImpl(container.resolve<CommandRegistryPort>(TOKENS.CommandRegistry))
  );
  container.register(TOKENS.AIRewriteService, () =>
    new AIRewriteServiceImpl(container.resolve<AIProviderPort>(TOKENS.AIProvider))
  );

  // Register AI Assistant services
  container.register(TOKENS.ToolRegistryService, () =>
    new ToolRegistryServiceImpl(
      container.resolve<ToolRegistryPort>(TOKENS.ToolRegistry),
      container.resolve<ToolExecutorPort>(TOKENS.ToolExecutor)
    )
  );
  container.register(TOKENS.AIAssistantService, () => {
    // ConversationStore + ToolInvocationService are constructed
    // alongside AIAssistant. Side-effects flow back to AIAssistant via
    // explicit callbacks so the peers don't import each other.
    let assistant: AIAssistantServiceImpl | null = null;
    const conversationStore = new ConversationStore({
      contextProvider: container.resolve<ContextProviderPort>(TOKENS.ContextProvider),
      conversationStorage: container.resolve<ConversationStoragePort>(TOKENS.ConversationStorage),
      voidStorage: container.resolve<VoidStoragePort>(TOKENS.VoidStorage),
      notesPath,
      onCurrentConversationChanged: () => assistant?.notifyStateSubscribers(),
    });
    const toolInvocationService = new ToolInvocationService({
      toolRegistry: container.resolve<ToolRegistryService>(TOKENS.ToolRegistryService),
      toolExecutor: container.resolve<ToolExecutorPort>(TOKENS.ToolExecutor),
      attachInvocation: (cid, mid, inv) =>
        conversationStore.update(cid, (conv) =>
          updateMessage(conv, mid, (msg) => addToolInvocation(msg, inv)),
        ),
      updateInvocation: (cid, mid, inv) =>
        conversationStore.update(cid, (conv) =>
          updateMessage(conv, mid, (msg) =>
            updateToolInvocation(msg, inv.id, () => inv),
          ),
        ),
      setExecutingTools: (executing) => assistant?.setExecutingTools(executing),
    });
    assistant = new AIAssistantServiceImpl(
      container.resolve<AIAssistantProviderPort>(TOKENS.AIAssistantProvider),
      container.resolve<ToolRegistryService>(TOKENS.ToolRegistryService),
      container.resolve<ToolExecutorPort>(TOKENS.ToolExecutor),
      container.resolve<ContextProviderPort>(TOKENS.ContextProvider),
      conversationStore,
      toolInvocationService,
      container.resolve<ProvenanceService>(TOKENS.ProvenanceService),
      container.resolve<IndexService>(TOKENS.IndexService),
      container.resolve<ReferenceService>(TOKENS.ReferenceService),
    );
    return assistant;
  });

  // Register Agent Loop service
  container.register(TOKENS.AgentLoopService, () =>
    new AgentLoopServiceImpl(
      container.resolve<AIAssistantService>(TOKENS.AIAssistantService),
      container.resolve<ToolExecutorPort>(TOKENS.ToolExecutor),
      container.resolve<OperationRunner>(TOKENS.OperationRunner)
    )
  );

  container.register(TOKENS.AgentIntakeService, () =>
    new AgentIntakeServiceImpl(
      container.resolve<AIAssistantProviderPort>(TOKENS.AIAssistantProvider),
      container.resolve<ToolRegistryService>(TOKENS.ToolRegistryService),
      container.resolve<ContextProviderPort>(TOKENS.ContextProvider),
      container.resolve<ReferenceService>(TOKENS.ReferenceService)
    )
  );

  // Register TODO service
  container.register(TOKENS.TodoService, () =>
    new TodoServiceImpl(
      container.resolve<TodoRepositoryPort>(TOKENS.TodoRepository),
      container.resolve<TodoWatcherPort>(TOKENS.TodoWatcher),
      container.resolve<FileSystemPort>(TOKENS.FileSystem),
      { notesPath }
    )
  );

  // Register CommandBus for event-driven architecture (must be before services that use it)
  container.register(TOKENS.CommandBus, () =>
    new CommandBus(
      container.resolve<DocumentPort>(TOKENS.DocumentStorage)
    )
  );

  // Register Notes service
  container.register(TOKENS.NotesService, () =>
    new NotesServiceImpl(
      container.resolve<DocumentPort>(TOKENS.DocumentStorage),
      container.resolve<CommandBus>(TOKENS.CommandBus)
    )
  );

  // Register typed app navigation bridge for AI tools and orchestration
  container.register(TOKENS.ApplicationNavigation, () =>
    new EventApplicationNavigationAdapter(
      container.resolve<NotesService>(TOKENS.NotesService)
    )
  );

  // Register markdown ↔ block serializer adapter (port keeps the
  // application layer free of direct ProseMirror/markdown imports).
  container.register(TOKENS.MarkdownSerializer, () => new MarkdownSerializerAdapter());

  // Register Provenance service (legacy receipt stream folded into lineage).
  container.register(TOKENS.ProvenanceService, () =>
    new ProvenanceServiceImpl(
      container.resolve<VoidStoragePort>(TOKENS.VoidStorage),
      notesPath
    )
  );

  // Register Session service (groups notes from AI batch operations).
  container.register(TOKENS.SessionService, () =>
    new SessionServiceImpl(
      container.resolve<SessionStoragePort>(TOKENS.SessionStorage)
    )
  );

  // Register Lineage service before DocumentService so document writes can
  // record markdown-sidecar history without changing the .md file.
  container.register(TOKENS.LineageService, () =>
    new LineageServiceImpl(
      container.resolve<LineageStoragePort>(TOKENS.LineageStorage),
      container.resolve<ProvenanceService>(TOKENS.ProvenanceService),
    )
  );

  // Register Document service (headless content API for AI tools)
  container.register(TOKENS.DocumentService, () =>
    new DocumentServiceImpl(
      container.resolve<DocumentPort>(TOKENS.DocumentStorage),
      container.resolve<NotesService>(TOKENS.NotesService),
      container.resolve<MarkdownSerializerPort>(TOKENS.MarkdownSerializer),
      container.resolve<TodoService>(TOKENS.TodoService),
      container.resolve<LineageService>(TOKENS.LineageService),
    )
  );

  // Register GitHub sync service. Secrets remain behind CredentialService;
  // settings store only the non-secret repo/account configuration.
  container.register(TOKENS.SyncService, () =>
    new SyncServiceImpl(
      container.resolve<GitRepositoryPort>(TOKENS.GitRepository),
      container.resolve<GitHubPort>(TOKENS.GitHub),
      container.resolve<SettingsService>(TOKENS.SettingsService),
      container.resolve<CredentialService>(TOKENS.CredentialService),
      notesPath,
      container.resolve<NotesService>(TOKENS.NotesService),
      container.resolve<EditorService>(TOKENS.EditorService),
      container.resolve<DocumentService>(TOKENS.DocumentService),
      container.resolve<VoidStoragePort>(TOKENS.VoidStorage),
    )
  );
  container.register(TOKENS.WorkspaceService, () =>
    new WorkspaceServiceImpl(
      container.resolve<SettingsService>(TOKENS.SettingsService),
      container.resolve<EditorService>(TOKENS.EditorService),
      container.resolve<SyncService>(TOKENS.SyncService),
      container.resolve<FileSystemPort>(TOKENS.FileSystem),
      container.resolve<VoidStoragePort>(TOKENS.VoidStorage),
    )
  );

  container.register(TOKENS.ReferenceService, () =>
    new ReferenceServiceImpl(
      container.resolve<NotesService>(TOKENS.NotesService),
      container.resolve<DocumentService>(TOKENS.DocumentService),
      container.resolve<TodoService>(TOKENS.TodoService),
      container.resolve<ContextProviderPort>(TOKENS.ContextProvider),
      container.resolve<ConversationStoragePort>(TOKENS.ConversationStorage),
      container.resolve<AgentRunStoragePort>(TOKENS.AgentRunStorage),
      container.resolve<OperationStoragePort>(TOKENS.OperationStorage),
    )
  );

  // Register active-editor-aware collaboration service for AI/tool writes.
  container.register(TOKENS.NoteCollaborationService, () =>
    new NoteCollaborationServiceImpl(
      container.resolve<EditorService>(TOKENS.EditorService),
      container.resolve<DocumentService>(TOKENS.DocumentService),
      container.resolve<NotesService>(TOKENS.NotesService),
      container.resolve<MarkdownSerializerPort>(TOKENS.MarkdownSerializer),
    )
  );

  container.register(TOKENS.CommitmentLineageService, () =>
    new CommitmentLineageServiceImpl(
      container.resolve<TodoService>(TOKENS.TodoService),
      container.resolve<LineageService>(TOKENS.LineageService),
    )
  );

  // Register ContextBuilder (depends on FileService + NotesService)
  container.register(TOKENS.ContextBuilder, () =>
    new ContextBuilderAdapter(
      container.resolve<FileService>(TOKENS.FileService),
      container.resolve<NotesService>(TOKENS.NotesService)
    )
  );

  // Register Operation service (sandboxed to user's notes folder)
  container.register(TOKENS.OperationService, () =>
    new OperationServiceImpl(
      container.resolve<CLISessionManagerPort>(TOKENS.CLISessionManager),
      container.resolve<CLIProviderPort>(TOKENS.CLIProvider),
      container.resolve<ContextBuilderPort>(TOKENS.ContextBuilder),
      container.resolve<ResultParserPort>(TOKENS.ResultParser),
      container.resolve<OperationStoragePort>(TOKENS.OperationStorage),
      notesPath,
      container.resolve<DocumentService>(TOKENS.DocumentService),
      container.resolve<NoteCollaborationService>(TOKENS.NoteCollaborationService),
      container.resolve<TodoService>(TOKENS.TodoService),
      container.resolve<VoidStoragePort>(TOKENS.VoidStorage)
    )
  );

  // Register Index service (Artifact system).
  // Constructor-injects DocumentService; the previous setDocumentService
  // post-wire dance is gone — DocumentService is registered earlier in
  // bootstrap so resolution succeeds at first use.
  container.register(TOKENS.IndexService, () =>
    new IndexServiceImpl(
      container.resolve<VoidStoragePort>(TOKENS.VoidStorage),
      container.resolve<AIAssistantProviderPort>(TOKENS.AIAssistantProvider),
      container.resolve<NotesService>(TOKENS.NotesService),
      notesPath,
      container.resolve<DocumentService>(TOKENS.DocumentService)
    )
  );

  // Register Branch service (Artifact system)
  container.register(TOKENS.BranchService, () =>
    new BranchServiceImpl(
      container.resolve<VoidStoragePort>(TOKENS.VoidStorage),
      container.resolve<AIAssistantProviderPort>(TOKENS.AIAssistantProvider),
      notesPath,
      container.resolve<DocumentService>(TOKENS.DocumentService),
      container.resolve<NoteCollaborationService>(TOKENS.NoteCollaborationService),
      container.resolve<LineageService>(TOKENS.LineageService),
    )
  );

  // Register Pulse service (Artifact system — proactive intelligence)
  container.register(TOKENS.PulseService, () =>
    new PulseServiceImpl(
      container.resolve<VoidStoragePort>(TOKENS.VoidStorage),
      container.resolve<NotesService>(TOKENS.NotesService),
      container.resolve<TodoService>(TOKENS.TodoService),
      notesPath
    )
  );

  // Register cross-note SearchService — wraps ContentSearchPort and
  // enriches hits with display titles from NotesService.
  container.register(TOKENS.SearchService, () =>
    new SearchServiceImpl(
      container.resolve<ContentSearchPort>(TOKENS.ContentSearch),
      container.resolve<NotesService>(TOKENS.NotesService)
    )
  );

  // Register RelationsService — parses note markdown for [[wikilinks]] and
  // [text](path) references, exposes backlinks + outgoing links per note.
  container.register(TOKENS.RelationsService, () =>
    new RelationsServiceImpl(
      container.resolve<NotesService>(TOKENS.NotesService),
      container.resolve<DocumentService>(TOKENS.DocumentService)
    )
  );

  // Register FrecencyService — recency × frequency scoring with persistence
  // to .void/index/frecency.json.
  container.register(TOKENS.FrecencyService, () =>
    new FrecencyServiceImpl(
      container.resolve<VoidStoragePort>(TOKENS.VoidStorage),
      notesPath
    )
  );

  // Register SidebarPreferencesService — persistent favorites and visual
  // folder ordering for the sidebar.
  container.register(TOKENS.SidebarPreferencesService, () =>
    new SidebarPreferencesServiceImpl(
      container.resolve<VoidStoragePort>(TOKENS.VoidStorage),
      notesPath
    )
  );

  // Register ActionHistoryService — bounded in-memory undo stack for
  // destructive operations (note delete, bulk move, AI rewrite, etc.).
  container.register(TOKENS.ActionHistoryService, () => new ActionHistoryServiceImpl());

  // Register ClipboardService — captures system clipboard changes via the
  // Rust watcher (Tauri) or a memory mock (browser dev mode).
  if (useMocks) {
    container.register(TOKENS.ClipboardWatcher, () => new MemoryClipboardWatcher());
    container.register(TOKENS.ClipboardWriter, () => new MemoryClipboardWriter());
  } else {
    container.register(TOKENS.ClipboardWatcher, () => new TauriClipboardWatcher());
    container.register(TOKENS.ClipboardWriter, () => new TauriClipboardWriter());
  }
  container.register(TOKENS.ClipboardService, () =>
    new ClipboardServiceImpl(
      container.resolve<ClipboardWatcher>(TOKENS.ClipboardWatcher),
      container.resolve<ClipboardWriter>(TOKENS.ClipboardWriter)
    )
  );

  // Register UpdaterService — wraps the Tauri updater plugin in
  // production, no-op (always up to date) in mock mode.
  if (useMocks) {
    container.register(TOKENS.Updater, () => new MemoryUpdaterAdapter());
  } else {
    container.register(TOKENS.Updater, () => new TauriUpdaterAdapter());
  }
  container.register(TOKENS.UpdaterService, () =>
    new UpdaterServiceImpl(container.resolve<UpdaterPort>(TOKENS.Updater))
  );

  // Register CaptureService — orchestrates the global quick-capture flow
  // (inbox / daily targets) on top of DocumentService. The window-management
  // adapter (captureWindowManager) is wired separately further down.
  container.register(TOKENS.CaptureService, () =>
    new CaptureServiceImpl(
      container.resolve<DocumentService>(TOKENS.DocumentService)
    )
  );

  // Register in-app swarm services. Workers are isolated read-only agents;
  // the durable orchestrator remains the only writer.
  container.register(TOKENS.ScopedWorkerToolExecutor, () =>
    new ScopedWorkerToolExecutor(
      container.resolve<ToolExecutorPort>(TOKENS.ToolExecutor)
    )
  );
  container.register(TOKENS.AgentSwarmPlanner, () =>
    new AgentSwarmPlanner(
      container.resolve<AIAssistantProviderPort>(TOKENS.AIAssistantProvider),
      container.resolve<ContextProviderPort>(TOKENS.ContextProvider)
    )
  );
  container.register(TOKENS.AgentWorkerRunner, () =>
    new AgentWorkerRunner(
      container.resolve<AIAssistantProviderPort>(TOKENS.AIAssistantProvider),
      container.resolve<ContextProviderPort>(TOKENS.ContextProvider),
      container.resolve<ToolRegistryService>(TOKENS.ToolRegistryService),
      container.resolve<ScopedWorkerToolExecutor>(TOKENS.ScopedWorkerToolExecutor)
    )
  );
  container.register(TOKENS.AgentWorkerBus, () => new AgentWorkerBus());
  container.register(TOKENS.AgentWorkerScheduler, () => new AgentWorkerScheduler());
  container.register(TOKENS.AgentMergeService, () => new AgentMergeService());

  // Register deep research services. The evidence service fetches and
  // extracts claims from sources; the pipeline orchestrates the phases.
  container.register(TOKENS.DeepResearchEvidence, () =>
    new DeepResearchEvidence(
      container.resolve<AIAssistantProviderPort>(TOKENS.AIAssistantProvider),
      container.resolve<ContextProviderPort>(TOKENS.ContextProvider),
      container.resolve<WebFetchPort>(TOKENS.WebFetch)
    )
  );
  container.register(TOKENS.PhaseNarrator, () =>
    new PhaseNarrator(
      container.resolve<AIAssistantProviderPort>(TOKENS.AIAssistantProvider),
      container.resolve<ContextProviderPort>(TOKENS.ContextProvider)
    )
  );
  container.register(TOKENS.DeepResearchPipeline, () =>
    new DeepResearchPipeline(
      new AgentRunEngineClass(
        container.resolve<AgentRunStoragePort>(TOKENS.AgentRunStorage),
        container.resolve<AgentEventStreamPort>(TOKENS.AgentEventStream)
      ),
      container.resolve<AIAssistantProviderPort>(TOKENS.AIAssistantProvider),
      container.resolve<ContextProviderPort>(TOKENS.ContextProvider),
      container.resolve<ResearchSourcePort>(TOKENS.ResearchSource),
      container.resolve<DeepResearchEvidence>(TOKENS.DeepResearchEvidence),
      container.resolve<NoteCollaborationService>(TOKENS.NoteCollaborationService),
      container.resolve<DocumentService>(TOKENS.DocumentService),
      container.resolve<PhaseNarrator>(TOKENS.PhaseNarrator)
    )
  );

  // Register durable agent orchestration service
  container.register(TOKENS.AgentOrchestrationService, () =>
    new AgentOrchestrationServiceImpl(
      container.resolve<AgentLoopService>(TOKENS.AgentLoopService),
      container.resolve<AgentRunStoragePort>(TOKENS.AgentRunStorage),
      container.resolve<AgentEventStreamPort>(TOKENS.AgentEventStream),
      container.resolve<ResearchSourcePort>(TOKENS.ResearchSource),
      container.resolve<NotesService>(TOKENS.NotesService),
      container.resolve<DocumentService>(TOKENS.DocumentService),
      container.resolve<ApplicationNavigationPort>(TOKENS.ApplicationNavigation),
      container.resolve<ProvenanceService>(TOKENS.ProvenanceService),
      container.resolve<IndexService>(TOKENS.IndexService),
      container.resolve<AIAssistantService>(TOKENS.AIAssistantService),
      container.resolve<AgentSwarmPlanner>(TOKENS.AgentSwarmPlanner),
      container.resolve<AgentWorkerRunner>(TOKENS.AgentWorkerRunner),
      container.resolve<AgentWorkerBus>(TOKENS.AgentWorkerBus),
      container.resolve<AgentWorkerScheduler>(TOKENS.AgentWorkerScheduler),
      container.resolve<AgentMergeService>(TOKENS.AgentMergeService),
      container.resolve<NoteCollaborationService>(TOKENS.NoteCollaborationService),
      container.resolve<DeepResearchPipeline>(TOKENS.DeepResearchPipeline),
      container.resolve<SessionService>(TOKENS.SessionService),
      container.resolve<ReferenceService>(TOKENS.ReferenceService)
    )
  );

  // 5. Resolve services
  // Note: settingsService was resolved earlier to load settings
  const settings = settingsService;
  const workspaces = container.resolve<WorkspaceService>(TOKENS.WorkspaceService);
  const files = container.resolve<FileService>(TOKENS.FileService);
  const credentials = container.resolve<CredentialService>(TOKENS.CredentialService);
  const editor = container.resolve<EditorService>(TOKENS.EditorService);
  const commands = container.resolve<CommandService>(TOKENS.CommandService);
  const aiRewrite = container.resolve<AIRewriteService>(TOKENS.AIRewriteService);
  const toolRegistry = container.resolve<ToolRegistryService>(TOKENS.ToolRegistryService);
  const aiAssistant = container.resolve<AIAssistantService>(TOKENS.AIAssistantService);
  const todoService = container.resolve<TodoService>(TOKENS.TodoService);
  const notesService = container.resolve<NotesService>(TOKENS.NotesService);
  const operationService = container.resolve<OperationService>(TOKENS.OperationService);
  const agentOrchestration = container.resolve<AgentOrchestrationService>(TOKENS.AgentOrchestrationService);
  void agentOrchestration.reconcileStuckRuns();
  const agentIntake = container.resolve<AgentIntakeService>(TOKENS.AgentIntakeService);
  const keymap = container.resolve<KeymapService>(TOKENS.KeymapService);
  const search = container.resolve<SearchService>(TOKENS.SearchService);
  const relations = container.resolve<RelationsService>(TOKENS.RelationsService);
  const lineage = container.resolve<LineageService>(TOKENS.LineageService);
  const frecency = container.resolve<FrecencyService>(TOKENS.FrecencyService);
  const references = container.resolve<ReferenceService>(TOKENS.ReferenceService);
  const sidebarPreferences = container.resolve<SidebarPreferencesService>(TOKENS.SidebarPreferencesService);
  const actionHistory = container.resolve<ActionHistoryService>(TOKENS.ActionHistoryService);
  const clipboard = container.resolve<ClipboardService>(TOKENS.ClipboardService);
  const capture = container.resolve<CaptureService>(TOKENS.CaptureService);
  const updater = container.resolve<UpdaterService>(TOKENS.UpdaterService);
  const sync = container.resolve<SyncService>(TOKENS.SyncService);
  const gitRepository = container.resolve<GitRepositoryPort>(TOKENS.GitRepository);

  // Wire the global capture window + OS-level shortcut. In `useMocks` mode
  // (browser dev) we install a noop so the rest of the bootstrap is happy.
  const captureManager: CaptureWindowManager = useMocks
    ? new NoopCaptureWindowManager()
    : new TauriCaptureWindowManager();

  // Bridge cross-window events: capture window emits `void://capture-submit`,
  // we run the service and emit `void://capture-result` back. The bridge is
  // a no-op outside Tauri.
  let captureBridge: CaptureMessageBridge | null = null;
  if (!useMocks) {
    captureBridge = await attachCaptureMessageBridge(capture);
  }

  // Apply the persisted shortcut. Failures (chord conflict, missing macOS
  // accessibility permission) are logged inside the manager — bootstrap
  // continues regardless. Empty string disables the global shortcut.
  if (settingsResult.ok) {
    const initialShortcut = settingsResult.value.captureShortcut;
    const initialTarget = settingsResult.value.captureTargetDefault;
    void captureManager.applyShortcut(initialShortcut, initialTarget);
  }

  // Toast bridge for operation completion. Operations store emits the
  // event; the toast store subscribes here so the two stores stay decoupled.
  events.on('operation:completed', ({ operationId }) => {
    const op = operationService.getOperation(operationId);
    if (op) {
      toastStore.success(`"${op.label}" completed`, { duration: 5000 });
    }
  });

  // Toast bridge for editor errors. Save/load failures are silent in the
  // service layer (Result.err); the bridge surfaces them so the user
  // notices a failed autosave instead of losing work to it. The toast
  // is clickable so the user can jump straight to the offending note.
  events.on('document:save-failed', ({ path, error }) => {
    const where = path ? ` (${path})` : '';
    toastStore.error(`Failed to save${where}: ${error.message}`, {
      duration: 8000,
      ...(path ? { onClick: () => notesStore.selectNote(path) } : {}),
    });
  });
  events.on('document:load-failed', ({ path, error }) => {
    toastStore.error(`Failed to open ${path}: ${error.message}`, {
      duration: 8000,
      onClick: () => notesStore.selectNote(path),
    });
  });
  events.on('error:user-facing', ({ source, error }) => {
    toastStore.error(`${source}: ${error.message}`, { duration: 6000 });
  });
  events.on('sync:completed', () => {
    toastStore.success('Synced with GitHub', { duration: 4000 });
  });
  events.on('sync:failed', ({ error }) => {
    toastStore.error(`GitHub sync failed: ${error.message}`, { duration: 8000 });
  });
  events.on('sync:conflict', ({ conflicts }) => {
    toastStore.warning(`${conflicts.length} sync conflict${conflicts.length === 1 ? '' : 's'} need review`, {
      duration: 8000,
      onClick: () => uiStore.openSyncConflictWorkspace(),
    });
  });

  const clearAutoSyncTimer = () => {
    if (autoSyncTimer) clearTimeout(autoSyncTimer);
    autoSyncTimer = null;
  };

  const canAutoSync = (): boolean => {
    const syncSettings = settings.current().sync;
    if (!syncSettings.enabled || !syncSettings.autoSync || syncSettings.paused || !syncSettings.repository) {
      return false;
    }
    if (syncStore.status.operation !== 'idle' || syncStore.status.kind === 'syncing') {
      return false;
    }
    const editorState = editor.getState();
    return !editorState.isSaving
      && !editorState.aiProcessing
      && editorState.tabs.every((tab) => !tab.isDirty && !tab.isSaving);
  };

  const scheduleAutoSync = (delayMs = 30_000) => {
    const syncSettings = settings.current().sync;
    if (!syncSettings.enabled || !syncSettings.autoSync || syncSettings.paused || !syncSettings.repository) {
      clearAutoSyncTimer();
      return;
    }
    clearAutoSyncTimer();
    autoSyncTimer = setTimeout(async () => {
      autoSyncTimer = null;
      if (!canAutoSync()) {
        scheduleAutoSync(30_000);
        return;
      }
      const detected = await gitRepository.detect(notesPath);
      if (!detected.ok) {
        log.warn('Skipped background GitHub sync because Git status failed', {
          error: detected.error.message,
        });
        return;
      }
      const repo = detected.value;
      const hasChanges =
        repo.changedFiles.length > 0 ||
        repo.ahead > 0 ||
        repo.behind > 0 ||
        repo.conflicts.length > 0;
      if (!hasChanges) {
        log.debug('Skipped background GitHub sync; no Git changes');
        return;
      }
      const result = await sync.syncNow();
      if (!result.ok) {
        log.warn('Background GitHub sync failed', { error: result.error.message });
      }
    }, delayMs);
  };

  events.on('document:saved', () => scheduleAutoSync());
  events.on('file:changed', () => scheduleAutoSync(60_000));

  events.on('settings:changed', ({ key }) => {
    if (key === 'cliProvider' || key === 'aiReasoningEffort') {
      void reinitializeAI();
    }
    if (key === 'captureShortcut' || key === 'captureTargetDefault') {
      const current = settingsService.current();
      void captureManager.applyShortcut(
        current.captureShortcut,
        current.captureTargetDefault,
      );
    }
  });

  // 6. Initialize stores (UI primary adapters)
  settingsStore.init(settings);
  workspaceStore.init(workspaces);
  aiStore.init(aiAssistant);
  aiStore.initAgent(container.resolve<AgentLoopService>(TOKENS.AgentLoopService));
  aiStore.initAgentOrchestration(agentOrchestration);
  aiStore.initAgentIntake(agentIntake);
  aiStore.initContextProvider(container.resolve<ContextProviderPort>(TOKENS.ContextProvider));
  toolStore.init(toolRegistry);
  todoStore.init(todoService);

  // Load persisted ordering/frecency before Notes observes these services.
  const frecencyLoadResult = await frecency.load();
  if (!frecencyLoadResult.ok) {
    log.warn('Failed to load frecency', { error: String(frecencyLoadResult.error) });
  }

  const sidebarPreferencesLoadResult = await sidebarPreferences.load();
  if (!sidebarPreferencesLoadResult.ok) {
    log.warn('Failed to load sidebar preferences', { error: String(sidebarPreferencesLoadResult.error) });
  }

  notesStore.init(notesService, {
    actionHistory,
    documentService: container.resolve<DocumentService>(TOKENS.DocumentService),
    frecency,
    sidebarPreferences,
  });
  editorStore.init(editor);
  operationsStore.init(operationService);
  filesStore.init(files);
  credentialsStore.init(credentials);
  syncStore.init(sync);
  aiStore.initOperations(operationService);
  commandCenterStore.reset();
  await operationsStore.load();

  // 7. Sync settings store with already-loaded settings
  if (settingsResult.ok) {
    // Settings were already loaded, just sync the store state
    await settingsStore.load();
  }

  // 8. Register all tools.
  // Services are injected per-invocation via ToolExecutorAdapter's service
  // factory configured above; no global resolver needed.
  await registerAllTools(
    container.resolve<ToolRegistryPort>(TOKENS.ToolRegistry),
    container.resolve<ToolExecutorPort>(TOKENS.ToolExecutor),
  );

  // 9. Load tool store
  await toolStore.load();

  // 10. Initialize TODO store (loads todos and starts watching)
  await todoStore.load();
  if (todoStore.error) {
    toastStore.error(`Watcher init failed: ${todoStore.error.message}`, { duration: 8000 });
  }

  // 11. Initialize Notes store (loads folder tree)
  log.info('Loading notes', { path: notesPath });
  await notesStore.load();
  if (notesStore.error) {
    log.error('Failed to load notes', { error: String(notesStore.error) });
  } else {
    log.info('Notes loaded', { count: notesStore.noteCount });
  }

  // 12. Ensure .void/ directory structure exists
  const voidStorage = container.resolve<VoidStoragePort>(TOKENS.VoidStorage);
  const voidResult = await voidStorage.ensureStructure(notesPath);
  if (!voidResult.ok) {
    log.error('Failed to create .void/ structure', { error: String(voidResult.error) });
  } else {
    log.info('.void/ structure ready');
  }

  // 13. Wire the power-user command spine.
  //
  // a) Register global (non-slash) commands into the registry so they show
  //    up in the palette and are discoverable everywhere.
  // b) Forward each command's defaultKeybinding to the KeymapService.
  // c) Load any persisted user overrides.
  // d) Register scope predicates so the global keymap binder can build
  //    accurate ScopeSnapshots at dispatch time. Predicates are registered
  //    here (composition root) so the keymap layer doesn't import stores.
  // e) Sync the keymap reactive store.
  const commandRegistry = container.resolve<CommandRegistryPort>(TOKENS.CommandRegistry);
  registerGlobalCommands((cmd) => commandRegistry.register(cmd));
  wireCommandKeybindings(commandRegistry, keymap);
  const overridesResult = await keymap.load();
  if (!overridesResult.ok) {
    log.warn('Failed to load keymap overrides', { error: String(overridesResult.error) });
  }
  registerScopePredicate('editorFocused', defaultEditorFocusedPredicate);
  registerScopePredicate('modalOpen', defaultModalOpenPredicate);
  registerScopePredicate('paletteOpen', () => uiStore.quickSwitcherOpen);
  registerScopePredicate('aiSidebarOpen', () => uiStore.aiSidebarVisible);
  registerScopePredicate('tasksWorkspaceOpen', () => uiStore.tasksWorkspaceOpen);
  registerScopePredicate('focusMode', () => uiStore.focusMode);
  registerScopePredicate('sidebarVisible', () => notesStore.sidebarVisible);
  registerScopePredicate('activeNotePath', () => notesStore.selectedPath);
  registerScopePredicate('tagViewActive', () => notesStore.activeTagView !== null);
  registerScopePredicate('findBarOpen', () => uiStore.findBarOpen);
  keymapStore.init(keymap);
  relationsStore.init(relations);
  provenanceStore.init(container.resolve<ProvenanceService>(TOKENS.ProvenanceService));
  lineageStore.init(
    container.resolve<LineageService>(TOKENS.LineageService),
    container.resolve<NoteCollaborationService>(TOKENS.NoteCollaborationService),
    container.resolve<CommitmentLineageService>(TOKENS.CommitmentLineageService),
    editor,
    container.resolve<MarkdownSerializerPort>(TOKENS.MarkdownSerializer),
  );
  pulseStore.init(container.resolve<import('./ports/inbound/PulseService').PulseService>(TOKENS.PulseService));
  void pulseStore.refresh();
  branchesStore.init(container.resolve<import('./ports/inbound/BranchService').BranchService>(TOKENS.BranchService));
  clipboardStore.init(clipboard);
  void syncStore.refreshStatus();

  // Start tracking command + note interactions.
  events.on('note:opened', ({ path }) => frecency.record('note', path));
  events.on('note:renamed', ({ oldPath, newPath }) => frecency.move('note', oldPath, newPath));
  events.on('command:executed', ({ commandId }) => {
    if (commandId) frecency.record('command', commandId);
  });

  // Keep session memberships in sync with note lifecycle.
  const sessions = container.resolve<SessionService>(TOKENS.SessionService);
  events.on('note:renamed', ({ oldPath, newPath }) => {
    void sessions.renameNote(oldPath, newPath);
  });
  events.on('note:deleted', ({ path }) => {
    void sessions.removeNoteFromAll(path);
  });

  // Initialize the sessions store so the editor ribbon can render memberships.
  sessionsStore.init(sessions);

  // 14. Emit ready event
  events.emit('app:ready');

  // Fire-and-forget silent update check. On success with a payload, surface
  // a toast with a click handler that downloads + installs. Errors during
  // the background check are logged but never raised — offline launches
  // and unreachable endpoints must not block app startup.
  if (!useMocks) {
    void updater.checkForUpdates({ silent: true }).then((result) => {
      if (!result.ok) {
        log.info('Background update check failed', { error: String(result.error) });
        return;
      }
      const update = result.value;
      if (!update) return;
      toastStore.info(`Void v${update.version} available`, {
        duration: 10000,
        onClick: () => {
          void updater.installUpdate().then((installResult) => {
            if (!installResult.ok) {
              toastStore.error(
                `Update failed: ${installResult.error.message}`,
                { duration: 8000 },
              );
            }
          });
        },
      });
    });
  }

  // Cache context
  bootstrapped = true;
  appContext = {
    container,
    settings,
    workspaces,
    files,
    credentials,
    editor,
    commands,
    aiRewrite,
    toolRegistry,
    aiAssistant,
    todoService,
    notesService,
    operationService,
    agentOrchestration,
    agentIntake,
    keymap,
    search,
    relations,
    lineage,
    frecency,
    references,
    sidebarPreferences,
    actionHistory,
    clipboard,
    capture,
    captureManager,
    updater,
    sync,
  };

  // Track capture-related disposers so shutdown() can tear them down.
  captureDisposers = { manager: captureManager, bridge: captureBridge };

  return appContext;
}

/**
 * Check if the application has been bootstrapped.
 */
export function isBootstrapped(): boolean {
  return bootstrapped;
}

/**
 * Get the app context if bootstrapped, null otherwise.
 * Use bootstrap() to initialize if not yet done.
 */
export function getAppContext(): AppContext | null {
  return appContext;
}

/**
 * Re-initialize local AI CLI adapters after Settings changes.
 * API-key providers are no longer wired; this only updates local CLI choice
 * and Codex reasoning effort on already-resolved singleton adapters.
 */
export async function reinitializeAI(): Promise<void> {
  if (!appContext) return;

  const settingsResult = await appContext.settings.load();
  const settings = settingsResult.ok ? settingsResult.value : null;
  const cliProvider = normalizeCLIProvider(settings?.cliProvider);
  const aiReasoningEffort = normalizeAIReasoningEffort(settings?.aiReasoningEffort);
  const preferredCli = cliProvider === 'claude-code' ? 'claude' : 'codex';

  const provider = appContext.container.resolve<AIAssistantProviderPort>(TOKENS.AIAssistantProvider);
  if (provider instanceof CLIAIAdapter) {
    provider.setPreferredCli(preferredCli);
    provider.setReasoningEffort(aiReasoningEffort);
  }

  const cliProviderAdapter = appContext.container.resolve<CLIProviderPort>(TOKENS.CLIProvider);
  if (cliProviderAdapter instanceof ConfigurableCLIProvider) {
    cliProviderAdapter.configure({ cliProvider, aiReasoningEffort });
  }

  getLogger('Bootstrap').info('Local AI CLI reconfigured', {
    cliProvider,
    aiReasoningEffort,
  });
}

/**
 * Shut the application down cleanly.
 *
 * Disposes every cached singleton in the container that implements
 * `Disposable` (file watchers, loggers, AI processes), clears the
 * cached AppContext, and resets the bootstrap flag so a subsequent
 * `bootstrap()` call wires a fresh graph.
 *
 * Failures from individual disposers are aggregated and rethrown after
 * all of them have run, so one stuck watcher doesn't keep the app from
 * tearing down the rest.
 */
export async function shutdown(): Promise<void> {
  if (!appContext) return;
  const ctx = appContext;
  // Clear the cached context first so accidental reentrant calls don't
  // see a half-disposed graph.
  appContext = null;
  bootstrapped = false;
  if (autoSyncTimer) {
    clearTimeout(autoSyncTimer);
    autoSyncTimer = null;
  }
  if (captureDisposers) {
    try {
      await captureDisposers.bridge?.dispose();
    } catch {
      /* logged inside dispose */
    }
    try {
      await captureDisposers.manager.dispose();
    } catch {
      /* logged inside dispose */
    }
    captureDisposers = null;
  }
  await ctx.container.dispose();
}

/**
 * Reset bootstrap state (for testing only).
 * Clears the cached context and allows re-bootstrapping.
 */
export function resetBootstrap(): void {
  bootstrapped = false;
  appContext = null;
}
