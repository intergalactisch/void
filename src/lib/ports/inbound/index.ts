/**
 * Inbound Ports - Application API
 *
 * These interfaces define what the application exposes to the outside world
 * (UI components, stores, CLI, tests). Primary adapters (Svelte components,
 * stores) depend on these interfaces.
 *
 * In Hexagonal Architecture, inbound ports are the "driving" side -
 * they are called by primary adapters to drive the application.
 */

export type { SettingsService } from './SettingsService';
export type { FileService } from './FileService';
export { CREDENTIAL_KEYS, PROVIDER_CREDENTIAL_MAP, getCredentialKeyForProvider, type CredentialKey, type CredentialService } from './CredentialService';

// Editor services
export type { EditorService, EditorState, EditorMountOptions } from './EditorService';
export type {
  CommandService,
  CommandPaletteState,
  CommandSearchResult,
} from './CommandService';
export type { KeymapService, KeyBinding, KeyConflict } from './KeymapService';
export type { SearchService, SearchHit } from './SearchService';
export type { RelationsService, NoteLink } from './RelationsService';
export type { FrecencyService, FrecencyEntry, FrecencyKind } from './FrecencyService';
export type { ReferenceService, ReferenceTargetSummary } from './ReferenceService';
export type {
  FolderDropPosition,
  FolderMoveDirection,
  SidebarPreferencesService,
} from './SidebarPreferencesService';
export type { ActionHistoryService, RecordedAction } from './ActionHistoryService';
export type { ClipboardService, ClipboardEntry } from './ClipboardService';
export type { AIRewriteService, AIRewriteState } from './AIRewriteService';
export type { UpdaterService, UpdateInfo } from './UpdaterService';

// AI Assistant services
export type {
  AIAssistantService,
  PromptOptions,
  AIInteractionState,
} from './AIAssistantService';
export type {
  ToolRegistryService,
  QuickToolOptions,
  AIToolDefinition,
} from './ToolRegistryService';

// TODO service
export type {
  TodoService,
  CreateTodoOptions,
  TodoUpdatePatch,
  TodoStats,
  TodoListFile,
  CreateTodoListFileParams,
  UpdateTodoListFileParams,
  TodoSubscriptionCallback,
  TodoListSubscriptionCallback,
  Unsubscribe as TodoUnsubscribe,
} from './TodoService';

// Notes service
export type {
  NotesService,
  NotesState,
  NotesListItem,
  TagGroup,
} from './NotesService';

// Document service (headless content API for AI tools)
export type { DocumentService } from './DocumentService';

// Capture service (global quick-capture window backend)
export type {
  CaptureService,
  CaptureRequest,
  CaptureResult,
} from './CaptureService';

// AI/user collaboration service
export type {
  NoteCollaborationService,
  UpdateNoteParams,
  CreateCollaborativeNoteParams,
  BlockMutationParams,
} from './NoteCollaborationService';

// Operation service
export type {
  OperationService,
  OperationRequest,
  OperationSessionOptions,
  QueueStatus,
  OperationStateChange,
} from './OperationService';

// Artifact system services
export type { ProvenanceService } from './ProvenanceService';
export type {
  SessionService,
  SessionChangeEvent,
  SessionChangeAction,
} from './SessionService';
export type { IndexService, RelatedContext } from './IndexService';
export type { BranchService } from './BranchService';
export type { PulseService } from './PulseService';
export type {
  LineageService,
  LineageRecordOptions,
  LineageRecordResult,
  LineExplanation,
  LineHistory,
  LineageAgentContext,
  LineageAgentContextOptions,
  LineageDeletedLine,
  LineageDeletedRestorePreview,
  LineageEditCluster,
  LineageTimeline,
  LineageTimelineEntry,
  LineageClusterQuery,
  LineageQueuedChange,
  LineageQueueStatus,
} from './LineageService';
export type {
  CommitmentLineageService,
  CommitmentSourceInfo,
  CommitmentStaleCheck,
  CommitmentSourceStatus,
} from './CommitmentLineageService';

// Agent loop
export type {
  AgentLoopService,
  AgentOptions,
  AgentResult,
  AgentState,
  AgentPlan,
  AgentPlanStep,
} from './AgentLoopService';
export type {
  AgentOrchestrationService,
  AgentRunState,
  StartAgentRunOptions,
  ContinueWorkerOptions,
} from './AgentOrchestrationService';
export type {
  AgentIntakeDecision,
  AgentIntakeDecisionKind,
  AgentIntakeOptions,
  AgentIntakeService,
  ToolCapabilityManifestItem,
} from './AgentIntakeService';

// Tool services aggregate
export type { ToolServices, ToolServicesProvider } from './ToolServices';
