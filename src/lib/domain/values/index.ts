/**
 * Domain values barrel export
 *
 * Re-exports all domain value objects for convenient importing.
 * Example: import { BlockType, Mark, Selection } from '$lib/domain/values';
 */

export { BLOCK_TYPES, HEADING_TYPES, isHeading, getHeadingLevel } from './BlockType';
export type { BlockType, HeadingType } from './BlockType';

export { MARK_TYPES, createMark, createLinkMark, createPageLinkMark } from './Mark';
export type { MarkType, Mark, LinkMark, PageLinkMark } from './Mark';

export { EMPTY_SELECTION, isCollapsed, hasSelection } from './Selection';
export type { Selection } from './Selection';

export { createDocumentMeta } from './DocumentMeta';
export type { DocumentMeta } from './DocumentMeta';

export {
  DEFAULT_PROTECTION_POLICY,
  PROTECTED_FRONTMATTER_KEYS,
  PROTECTED_NOTE_ALGORITHM,
  PROTECTED_NOTE_ENVELOPE_VERSION,
  createProtectedNoteMeta,
  customFromProtectionMeta,
  isLockedProtectedMeta,
  isProtectedDocumentMeta,
  isProtectedNoteMeta,
  normalizeProtectionPolicy,
  protectionMetaFromCustom,
  stripProtectionCustom,
} from './Protection';
export type {
  AIContextAuthorization,
  AIContextAuthorizationScope,
  LockState,
  ProtectedNoteMeta,
  ProtectionLevel,
  ProtectionPolicy,
} from './Protection';

export { formatDailyDate, formatDailyTime, dailyNotePath } from './DailyDate';
export { deriveTextNoteTitle } from './TextNoteTitle';
export type { TextNoteTitleOptions } from './TextNoteTitle';

export { deriveResearchTopic } from './ResearchTopic';
export type { DerivedResearchTopic } from './ResearchTopic';

export {
  REF_ID_SCHEME,
  buildRefId,
  parseRefId,
  extractRefIds,
  isRefId,
} from './RefId';
export type {
  RefId,
  RefIdKind,
  ParsedRefId,
  RefIdInput,
} from './RefId';

export { normalizeNoteTag, normalizeNoteTags, formatNoteTag } from './NoteTags';

export { BUILTIN_COMMANDS } from './Command';
export type { SlashCommand, CommandGroup, CommandCategory } from './Command';

export { EMPTY_SCOPE } from './ScopeSnapshot';
export type { ActiveKeymapContext, ScopeSnapshot } from './ScopeSnapshot';

export {
  EMPTY_NOTE_WORKSPACE_LAYOUT,
  NOTE_WORKSPACE_LAYOUT_VERSION,
  isNotePaneLeaf,
  isNotePaneSplit,
} from './NoteWorkspaceLayout';
export type {
  DragKind,
  DropPlacement,
  NotePaneDirection,
  NotePaneDragPayload,
  NotePaneDropIntent,
  NotePaneMoveIntent,
  NotePaneMoveResult,
  NotePaneLeaf,
  NotePaneNode,
  NotePaneSplit,
  NoteWorkspaceLayoutState,
  NoteWorkspaceTab,
} from './NoteWorkspaceLayout';

export {
  NULL_CHORD,
  parseChord,
  formatChord,
  serializeChord,
  chordsEqual,
  chordFromKeyboardEvent,
  detectPlatform,
} from './KeyChord';
export type { KeyChord, Platform } from './KeyChord';

// AI-related value objects
export {
  createToolId,
  parseToolId,
  isValidToolId,
  getToolNamespace,
  getToolAction,
  TOOL_IDS,
} from './ToolId';
export type { ToolId, ToolNamespace } from './ToolId';

export type { AIOperation } from './AIOperation';
export { AI_UNAVAILABLE_MESSAGE } from './AIAvailability';
export type { AIAvailabilityStatus } from './AIAvailability';

export {
  DEFAULT_AI_CONFIGS,
  getProviderDisplayName,
  providerRequiresApiKey,
  getProviderModels,
} from './AIProviderType';
export type {
  AIProviderType,
  AIModel,
  BaseAIConfig,
  ClaudeConfig,
  OpenAIConfig,
  GeminiConfig,
  OllamaConfig,
  MockAIConfig,
  AIProviderConfig,
} from './AIProviderType';

export {
  createEmptyContext,
  createPromptContext,
  createNoteSummary,
  serializeContext,
} from './PromptContext';
export type {
  NoteSummary,
  EditorContext,
  NavigationContext,
  ResolvedPromptReference,
  PromptContext,
} from './PromptContext';

export {
  toolSuccess,
  toolPartial,
  toolFailure,
  toolCancelled,
  isToolSuccess,
  isToolPartial,
  isToolFailure,
  isToolCancelled,
  isToolCompleted,
  getToolData,
  serializeToolResult,
} from './ToolResult';
export type {
  ResultSeverity,
  ResultMessage,
  ToolResultSuccess,
  ToolResultPartial,
  ToolResultFailure,
  ToolResultCancelled,
  ToolResult,
} from './ToolResult';

export {
  createEmptyResponse,
  createToolCall,
  hasToolCalls,
  hasChatContent,
  summarizeResponse,
  mergeChunk,
  parseToolCalls,
  extractChatContent,
} from './AIResponse';
export type {
  ToolCall,
  AIUsage,
  AIResponseMeta,
  AIResponse,
  AIResponseChunk,
} from './AIResponse';

export type { AIWebAccess } from './AIWebAccess';
export type { ResearchCitation } from './ResearchCitation';
export { classifyDurableAgentPrompt } from './AgentPromptIntent';
export type { DurableAgentPromptIntent, DurableAgentPromptMode } from './AgentPromptIntent';

// Todo-related value objects
export {
  generateTodoId,
  parseTodoId,
  isValidTodoId,
  getTodoFilePath,
  getTodoLineNumber,
} from './TodoId';
export type { TodoId } from './TodoId';

export {
  TODO_SOURCES,
  ALL_TODO_SOURCES,
  isValidTodoSource,
  getTodoSourceDisplayName,
} from './TodoSource';
export type { TodoSource } from './TodoSource';

export {
  TODO_PRIORITIES,
  ALL_TODO_PRIORITIES,
  priorityOrder,
  isValidTodoPriority,
  comparePriority,
  getPriorityDisplayName,
} from './TodoPriority';
export type { TodoPriority } from './TodoPriority';

export {
  DATE_MARKERS,
  createEmptyDateMeta,
  formatCompletedAt,
  formatCreatedAt,
  formatDueDate,
  formatScheduledDate,
  formatRecurrence,
  formatDateOnly,
  hasDateMeta,
  isOverdue,
  isDueToday,
  isScheduledForToday,
} from './TodoDateMeta';
export type { TodoDateMeta } from './TodoDateMeta';

export {
  DEFAULT_TODO_FILTER,
  ALL_TODOS_FILTER,
  COMPLETED_TODOS_FILTER,
  matchesFilter,
  filterTodos,
  createDueTodayFilter,
  createFileFilter,
  createTagsFilter,
  mergeFilters,
  hasActiveFilters,
} from './TodoFilter';
export type { TodoFilter } from './TodoFilter';

export { TODO_FILENAME, getDefaultTodoFilePath } from './TodoConstants';

export {
  TODO_LIST_FILE_PREFIX,
  TODO_LIST_FILE_EXTENSION,
  TODO_LIST_FRONTMATTER_KEY,
  TODO_LIST_FRONTMATTER_TYPE,
  getTodoListFileName,
  slugifyTodoListTitle,
  validateTodoListTitle,
  isDefaultTodoFilePath,
  isTodoListMarkdown,
  parseTodoListMarkdown,
  parseTodoListMarkdownContent,
  createTodoListMarkdown,
  updateTodoListMarkdown,
} from './TodoListFile';
export type {
  TodoListFile,
  CreateTodoListFileParams,
  UpdateTodoListFileParams,
  ParsedTodoListMarkdown,
} from './TodoListFile';

export {
  TODO_VIEWS,
  TODO_LISTS,
  DEFAULT_TODO_VIEW,
  isValidTodoView,
  isValidTodoList,
  getTodoViewLabel,
  getTodoListHeading,
  getTodoListFromHeading,
} from './TodoView';
export type { TodoView, TodoList } from './TodoView';

// Logging
export { createLogEntry } from './LogEntry';
export type { LogLevel, LogEntry } from './LogEntry';

// Operation system value objects
export { createOperationId, isValidOperationId } from './OperationId';
export type { OperationId } from './OperationId';

export { isTerminalStatus, isRunningStatus, isActiveStatus } from './OperationStatus';
export type { OperationStatus } from './OperationStatus';

export type { OperationType } from './OperationType';

export { createSessionId, isValidSessionId } from './SessionId';
export type { SessionId } from './SessionId';

export {
  EMPTY_SIDEBAR_PREFERENCES,
  SIDEBAR_PREFERENCES_VERSION,
  sidebarFavoriteKey,
} from './SidebarPreferences';
export type {
  SidebarFavoriteKind,
  SidebarFavoriteRef,
  SidebarPreferences,
} from './SidebarPreferences';

export { createEmptyOperationContext } from './OperationContext';
export type {
  OperationContext,
  NoteSummaryEntry,
  UserPreferences,
} from './OperationContext';

export { createEmptyOperationResult } from './OperationResult';
export type {
  OperationResult,
  OperationOutput,
  ContentOutput,
  TodoOutput,
  ReferenceOutput,
  MetadataOutput,
} from './OperationResult';

export { renderPromptTemplate } from './OperationTemplate';
export type {
  OperationTemplate,
  ContextRequirementType,
  ContextRequirement,
  ResultHandlingConfig,
  TemplateVariable,
} from './OperationTemplate';

export { toPersistedOperation, fromPersistedOperation } from './PersistedOperation';
export type { PersistedOperation } from './PersistedOperation';

// Note info (Artifact system)
export { NOTE_INTENTS, NOTE_INTENT_LABELS, INTENT_AI_HINTS, isValidIntent } from './NoteIntent';
export type { NoteIntent } from './NoteIntent';

export { NOTE_STATUSES, NOTE_STATUS_LABELS, isValidStatus } from './NoteStatus';
export type { NoteStatus } from './NoteStatus';

// Provenance (Artifact system)
export {
  PROVENANCE_EVENT_TYPES,
  createProvenanceEvent,
  parseProvenanceEvent,
  isAIEvent,
} from './ProvenanceEvent';
export type { ProvenanceEventType, ProvenanceEvent } from './ProvenanceEvent';

// Index graph (Artifact system)
export { createEmptyGraph } from './IndexGraph';
export type { NoteIndex, Relationship, IndexGraph, RelatedNote, NoteMatch } from './IndexGraph';

export {
  provenancePath,
  conversationDir,
  branchDir,
  inlineAIPath,
  indexPath,
  insightsPath,
  noteNameFromPath,
} from './VoidPath';

// Branch system (Artifact system)
export { BRANCH_STATUSES, isValidBranchStatus } from './BranchStatus';
export type { BranchStatus } from './BranchStatus';

// Pulse system (Artifact system)
export { INSIGHT_TYPES, INSIGHT_TYPE_LABELS, isValidInsightType } from './InsightType';
export type { InsightType } from './InsightType';

// Cloud sync
export {
  DEFAULT_SYNC_ARTIFACT_POLICY,
  DEFAULT_SYNC_SETTINGS,
  EMPTY_SYNC_STATUS,
  VOID_REPO_ARTIFACT_POLICY_VERSION,
  VOID_REPO_MANIFEST_PATH,
  VOID_REPO_SCHEMA_VERSION,
  VOID_GITHUB_SCOPE,
  cloneDefaultSyncSettings,
  createVoidRepoManifest,
  parseGitHubRemote,
  syncStatusFromRepo,
  validateSyncSettings,
  validateVoidRepoManifest,
} from './Sync';
export type {
  GitBranchInfo,
  GitFileChange,
  GitHubBranchSummary,
  GitHubCreatedRepository,
  GitHubDeviceAuthRequest,
  GitHubDeviceAuthStart,
  GitHubNameAvailability,
  GitHubRepoSummary,
  GitHubUser,
  GitHubVoidReadyProbe,
  GitRepositoryState,
  SyncArtifactPolicy,
  SyncAuthMode,
  SyncAuthProbe,
  SyncAuthState,
  SyncConflict,
  SyncConflictHunk,
  SyncConflictKind,
  SyncConflictMergeStatus,
  SyncConflictPreview,
  SyncConflictResolution,
  SyncConflictSession,
  SyncConflictSessionStatus,
  SyncConfig,
  SyncMode,
  SyncOperation,
  SyncProvider,
  SyncRepositoryRef,
  SyncRepoKind,
  SyncSettings,
  SyncStatus,
  SyncStatusKind,
  VoidRepoManifest,
} from './Sync';

export { mergeText3 } from './Diff3';
export type { Diff3MergeResult } from './Diff3';
