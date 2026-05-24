/**
 * Outbound ports barrel export
 *
 * Outbound ports define what the application NEEDS from infrastructure.
 * These are interfaces that adapters implement (secondary adapters).
 *
 * The domain and application layers depend on these interfaces,
 * never on concrete implementations.
 */

export type { FileSystemPort } from './FileSystemPort';
export type { SettingsStoragePort } from './SettingsStoragePort';
export type { CredentialPort } from './CredentialPort';
export type { UpdaterPort } from './UpdaterPort';

// Editor ports
export type {
  EditorPort,
  EditorEvents,
  EditorCommands,
  BlockInfo,
  EditorMenuStatePayload,
  EditorMenuPosition,
  EditorBlockMenuRequest,
  EditorPageLinkNote,
  EditorInlineGenerateCallbacks,
  EditorInlineGenerateRequest,
  EditorInlineGenerateResult,
  EditorInlineAIComposerStatus,
  EditorInlineAIComposerView,
  EditorInlineAIComposerState,
  EditorInlineAIRangeAnchorInput,
  EditorInlineAIRangeAnchorResult,
} from './EditorPort';
export type {
  EditorPortFactory,
  EditorPortFactoryOptions,
  EditorNotesProvider,
} from './EditorPortFactory';
export type { ExternalNavigationPort } from './ExternalNavigationPort';
export type { DocumentPort, DocumentListItem, DocumentFolderItem } from './DocumentPort';
export type {
  AIProviderPort,
  AIRewriteRequest,
  AIRewriteResponse,
  AIOperation,
} from './AIProviderPort';
export type {
  CommandRegistryPort,
  CommandContext,
  RegisteredCommand,
} from './CommandRegistryPort';
export type { KeymapStoragePort, KeymapOverrides } from './KeymapStoragePort';
export type { ContentSearchPort, ContentSearchOptions, RawHit } from './ContentSearchPort';
export type {
  CryptoPort,
  EncryptedStringEnvelope,
  WrappedKeyMaterial,
} from './CryptoPort';
export type { KeyCustodyPort } from './KeyCustodyPort';
export type {
  ProtectionCodecPort,
  ProtectedDocumentEnvelope,
} from './ProtectionCodecPort';
export type {
  GitRepositoryPort,
  GitCommitResult,
  GitMergeConflictFile,
  GitMergeFile,
  GitMergeStartResult,
  GitRemoteFile,
  GitAuthOptions,
  CreateBranchOptions,
} from './GitRepositoryPort';
export type {
  GitHubPort,
  GitHubCreateRepositoryParams,
  GitHubDeviceAuthCompleteParams,
  GitHubTokenResult,
} from './GitHubPort';

// AI Assistant ports
export type {
  ToolRegistryPort,
  ToolSearchOptions,
} from './ToolRegistryPort';
export type {
  ToolExecutorPort,
  ToolHandler,
  ToolExecutionContext,
} from './ToolExecutorPort';
export type { ContextProviderPort } from './ContextProviderPort';
export type {
  AIAssistantProviderPort,
  AIAssistantRequest,
  AIProviderConnectionConfig,
} from './AIAssistantProviderPort';
export type {
  ConversationStoragePort,
  ConversationSummary,
  ConversationSummaryQuery,
  ListConversationsOptions,
} from './ConversationStoragePort';
export type { PagedResult, SummaryQueryBase } from './PagedQuery';

// TODO system ports
export type { TodoRepositoryPort } from './TodoRepositoryPort';
export type { TodoParserPort, ParsedTodoMeta, TodoParseOptions } from './TodoParserPort';
export type {
  TodoWatcherPort,
  FileChangeCallback,
  Unsubscribe as WatcherUnsubscribe,
} from './TodoWatcherPort';

// Operation system ports
export type {
  CLISessionManagerPort,
  CLISpawnRequest,
  CLIProcessHandle,
  CLIProcessInfo,
  CLIProcessEvent,
} from './CLISessionManagerPort';
export type { CLIProviderPort, CLIBuildParams, ParsedCLIOutput } from './CLIProviderPort';
export type {
  ContextBuilderPort,
  ContextBuildOptions,
} from './ContextBuilderPort';
export type { ResultParserPort } from './ResultParserPort';

// Operation storage
export type { OperationStoragePort } from './OperationStoragePort';

// Logging
export type { LoggerPort } from './LoggerPort';

// Void storage
export type { VoidStoragePort } from './VoidStoragePort';
export type { LineageStoragePort } from './LineageStoragePort';
export type {
  AgentRunStoragePort,
  AgentRunSummary,
  AgentRunSummaryQuery,
} from './AgentRunStoragePort';
export type { SessionStoragePort } from './SessionStoragePort';
export type {
  AgentEventStreamPort,
  AgentEventSubscription,
} from './AgentEventStreamPort';
export { formatAgentSseEvent } from './AgentEventStreamPort';
export type {
  ResearchSourcePort,
  ResearchSourceSearchOptions,
} from './ResearchSourcePort';
export type {
  MediaSearchOptions,
  MediaSearchResult,
  MediaSourcePort,
} from './MediaSourcePort';
export type {
  WebFetchOptions,
  WebFetchPort,
  WebFetchResult,
} from './WebFetchPort';
export type {
  ApplicationNavigationPort,
  ApplicationView,
} from './ApplicationNavigationPort';

// Markdown ↔ block serialization (used by DocumentService)
export type { MarkdownSerializerPort, ParsedMarkdownDocument } from './MarkdownSerializerPort';
