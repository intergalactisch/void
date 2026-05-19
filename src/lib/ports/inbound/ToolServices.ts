/**
 * ToolServices - Aggregate of services available to tools at execution time.
 *
 * This is an inbound-side bundle: tools are entry points that orchestrate
 * the application's existing services. The bundle is injected into each
 * `ToolExecutionContext` by the ToolExecutorAdapter at execute time, so
 * tool handlers receive services via their context — not via a global
 * service locator.
 */

import type { EditorService } from './EditorService';
import type { NotesService } from './NotesService';
import type { TodoService } from './TodoService';
import type { FileService } from './FileService';
import type { DocumentService } from './DocumentService';
import type { LineageService } from './LineageService';
import type { NoteCollaborationService } from './NoteCollaborationService';
import type { OperationService } from './OperationService';
import type { BranchService } from './BranchService';
import type { CommitmentLineageService } from './CommitmentLineageService';
import type { SessionService } from './SessionService';
import type { AIAssistantProviderPort } from '$lib/ports/outbound/AIAssistantProviderPort';
import type { SettingsStoragePort } from '$lib/ports/outbound/SettingsStoragePort';
import type { ApplicationNavigationPort } from '$lib/ports/outbound/ApplicationNavigationPort';
import type { MediaSourcePort } from '$lib/ports/outbound/MediaSourcePort';

/**
 * Services available to all tools via context.services.
 */
export interface ToolServices {
  /** Notes list, navigation, create/delete/rename */
  notes: NotesService;
  /** Editor: open/save/close documents, insert/format/replace */
  editor: EditorService;
  /** Headless document read/write (markdown strings, no ProseMirror) */
  documents: DocumentService;
  /** Line-level markdown intent/version history */
  lineage: LineageService;
  /** Lineage-aware branch alternatives */
  branches: BranchService;
  /** Todo/commitment source-line intelligence */
  commitmentLineage: CommitmentLineageService;
  /** Active-editor-aware note mutation API for AI/user collaboration */
  collaboration: NoteCollaborationService;
  /** TODO: create, list, toggle, update, delete */
  todos: TodoService;
  /** File system operations */
  files: FileService;
  /** AI provider for tools that need LLM (summarize, expand, etc.) */
  ai: AIAssistantProviderPort;
  /** App settings */
  settings: SettingsStoragePort;
  /** AI operation queue (optional - available after operation system bootstrap) */
  operations?: OperationService;
  /** Typed app navigation and shell view control */
  navigation?: ApplicationNavigationPort;
  /** Current media lead lookup for research and media scout workers */
  mediaSources?: MediaSourcePort;
  /** Session membership — groups notes from AI batch operations */
  sessions?: SessionService;
}

/**
 * Late-binding factory for ToolServices.
 *
 * The bundle is built lazily because some services (e.g. AIAssistantService)
 * are registered after the ToolExecutorAdapter itself, so eager resolution
 * would observe a half-built container. Calling the factory at execute time
 * gives us a consistent snapshot.
 */
export type ToolServicesProvider = () => ToolServices;
