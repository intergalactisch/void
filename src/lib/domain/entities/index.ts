/**
 * Domain entities barrel export
 *
 * Re-exports all domain entities for convenient importing.
 * Example: import { Settings, DEFAULT_SETTINGS } from '$lib/domain/entities';
 */

export {
  type Settings,
  type CLIProviderId,
  type AIReasoningEffort,
  type UIDensity,
  type CaptureTarget,
  DEFAULT_SETTINGS,
  DEFAULT_AI_REASONING_EFFORT,
  DEFAULT_UI_DENSITY,
  DEFAULT_CAPTURE_TARGET,
  DEFAULT_CAPTURE_SHORTCUT,
  CLI_PROVIDER_OPTIONS,
  AI_REASONING_EFFORT_OPTIONS,
  UI_DENSITY_OPTIONS,
  CAPTURE_TARGET_OPTIONS,
  validateSettings,
  FONT_SIZE_RANGE,
  LINE_HEIGHT_RANGE,
  CONTENT_WIDTH_RANGE,
  AUTO_SAVE_DELAY_RANGE,
} from './Settings';

export {
  DEFAULT_WORKSPACE_NAME,
  MANAGED_DEFAULT_WORKSPACE_NAME,
  MANAGED_DEFAULT_WORKSPACE_PATH,
  MANAGED_WORKSPACE_ROOT,
  activeWorkspaceFrom,
  cloneWorkspace,
  createWorkspace,
  createWorkspaceId,
  generateManagedWorkspacePath,
  isAbsoluteOrTildePath,
  isLegacyDefaultWorkspacePath,
  isManagedDefaultWorkspacePath,
  needsManagedDefaultWorkspaceMigration,
  sanitizeWorkspaceFolderName,
  validateWorkspace,
  workspacePathEquals,
} from './Workspace';
export type { Workspace, GitHubAccountRef, CreateWorkspaceInput } from './Workspace';

export {
  generateBlockId,
  createBlock,
  createEmptyParagraph,
} from './Block';
export type {
  Block,
  BlockAttrs,
  BaseAttrs,
  ParagraphAttrs,
  HeadingAttrs,
  CodeBlockAttrs,
  ImageAttrs,
  TodoAttrs,
  CalloutAttrs,
  LinkAttrs,
} from './Block';

export { createDocument, extractTitle, countWords, findBlock } from './Document';
export type { Document } from './Document';

export { createEditorSession } from './EditorSession';
export type { EditorSession, EditorSessionConflictState } from './EditorSession';

// AI-related entities
export {
  createTool,
  getRequiredParameters,
  hasRequiredParameters,
  getMissingParameters,
  validateParameter,
  validateToolArgs,
  formatToolForAI,
  matchTool,
} from './Tool';
export type {
  ParameterSchema,
  ToolCategory,
  Tool,
} from './Tool';

export {
  createInvocation,
  startInvocation,
  updateProgress,
  completeInvocation,
  cancelInvocation,
  confirmInvocation,
  isTerminal,
  isPending,
  isExecuting,
  isSuccessful,
  needsConfirmation,
  getDuration,
  summarizeInvocation,
  serializeInvocation,
} from './ToolInvocation';
export type {
  InvocationStatus,
  ToolInvocation,
} from './ToolInvocation';

export {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createMessageFromResponse,
  appendText,
  addToolUse,
  addToolInvocation,
  updateToolInvocation,
  finishStreaming,
  setMetadata,
  getTextContent,
  getToolCalls,
  hasPendingInvocations,
  hasToolInvocations,
  getPreview as getMessagePreview,
  serializeMessage,
} from './Message';
export type {
  MessageRole,
  ContentBlockType,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ImageBlock,
  ContentBlock,
  Message,
} from './Message';

export {
  createConversation,
  addMessage,
  updateMessage,
  removeMessage,
  setTitle,
  setStatus,
  addTags,
  removeTags,
  clearMessages,
  getLastMessage,
  getLastUserMessage,
  getLastAssistantMessage,
  isEmpty,
  isAwaitingResponse,
  hasStreamingMessage,
  hasPendingTools,
  getMessageCount,
  getMessageCountByRole,
  getTotalWordCount,
  getMessagesForAPI,
  getPreview as getConversationPreview,
  serializeConversation,
} from './Conversation';
export type {
  ConversationStatus,
  Conversation,
} from './Conversation';

// Operation entity
export {
  createOperation,
  createSessionOperation,
  queueOperation,
  startOperation,
  completeOperation,
  failOperation,
  cancelOperation,
  updateOperationProgress,
  isSessionOperation,
} from './Operation';
export type {
  Operation,
  SessionOperation,
  OperationProgress,
} from './Operation';

// Agent orchestration entity
export {
  ACTIVE_AGENT_RUN_STATUSES,
  createAgentRun,
  createAgentTask,
  createAgentWorker,
  createAgentWorkerMessage,
  isActiveAgentRun,
  isActiveAgentRunStatus,
  normalizeAgentRun,
  touchAgentRun,
  setAgentTaskStatus,
  setAgentWorkerStatus,
} from './AgentRun';
export type {
  AgentArtifactDraft,
  AgentArtifactDraftType,
  AgentRun,
  AgentRunStatus,
  AgentOrchestrationMode,
  AgentTask,
  AgentTaskStatus,
  AgentTaskKind,
  AgentArtifact,
  AgentArtifactType,
  AgentMediaKind,
  AgentMergeState,
  AgentResearchEvidenceBundle,
  AgentExistingNoteEvidence,
  AgentRunPlan,
  AgentRunApproval,
  AgentWorkerCapability,
  AgentWorker,
  AgentWorkerMessage,
  AgentWorkerMessageType,
  AgentWorkerResult,
  AgentWorkerSpec,
  AgentWorkerStatus,
  AgentWorkerTargetResource,
  AgentWorkerWriteScope,
  AgentAssignedNote,
  AgentAssignedNoteRole,
  ResearchCitation,
} from './AgentRun';

// Todo entity
export {
  createTodo,
  toggleTodo,
  updateTodoContent,
  updateTodoPriority,
  updateTodoDueDate,
  updateTodoScheduledDate,
  addTodoTag,
  removeTodoTag,
  serializeTodo,
  sortTodos,
  sortTodosWithCompletedLast,
  groupTodosByFile,
  groupTodosByPriority,
  getAllTags,
  countTodosByStatus,
} from './Todo';
export type {
  Todo,
  CreateTodoParams,
} from './Todo';

// Session entity (Artifact system)
export {
  createSession,
  addSessionMember,
  removeSessionMember,
  renameSessionMember,
  setSessionStatus,
} from './Session';
export type {
  Session,
  SessionKind,
  SessionType,
  SessionRole,
  SessionStatus,
  SessionMember,
  CreateSessionParams,
} from './Session';

export {
  createEmptyLineageSnapshot,
  createIntentFrame,
  createLineageId,
  createLineageUnit,
  createLineVersion,
  getCurrentVersion,
  inferBlockType,
  materializeLineageMarkdown,
  normalizeLineContent,
  parseLineageLine,
  splitMarkdownLines,
  stableHash,
} from './Lineage';
export type {
  CreateIntentParams,
  CreateLineVersionParams,
  IntentActorKind,
  IntentFrame,
  IntentKind,
  LineActor,
  LineageChange,
  LineageGranularity,
  LineageJournalEntry,
  LineageLine,
  LineageMatchKind,
  LineagePatch,
  LineageSnapshot,
  LineageUnit,
  LineageUnitStatus,
  LineVersion,
  ReconciliationMatch,
  ReconciliationWarning,
} from './Lineage';
