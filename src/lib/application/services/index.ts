/**
 * Application Services - Use Case Implementations
 *
 * These services implement the inbound port interfaces and contain
 * the application's use case logic. They depend on outbound ports
 * (interfaces) but never on concrete adapter implementations.
 *
 * Part of Hexagonal Architecture application layer.
 */

export { SettingsServiceImpl } from './SettingsServiceImpl';
export { FileServiceImpl } from './FileServiceImpl';
export { CredentialServiceImpl } from './CredentialServiceImpl';
export { UpdaterServiceImpl } from './UpdaterServiceImpl';
export { AIRewriteServiceImpl } from './AIRewriteServiceImpl';
export { EditorServiceImpl } from './EditorServiceImpl';
export { CommandServiceImpl } from './CommandServiceImpl';
export { KeymapServiceImpl } from './KeymapServiceImpl';
export { SearchServiceImpl } from './SearchServiceImpl';
export { RelationsServiceImpl } from './RelationsServiceImpl';
export { FrecencyServiceImpl } from './FrecencyServiceImpl';
export { ReferenceServiceImpl, promptReferencesSection } from './ReferenceServiceImpl';
export { SidebarPreferencesServiceImpl } from './SidebarPreferencesServiceImpl';
export { ActionHistoryServiceImpl } from './ActionHistoryServiceImpl';
export { ClipboardServiceImpl } from './ClipboardServiceImpl';
export type {
  ClipboardWatcher,
  ClipboardWriter,
  ClipboardWatcherEvent,
} from './ClipboardServiceImpl';

// AI Assistant services
export { ToolRegistryServiceImpl } from './ToolRegistryServiceImpl';
export { AIAssistantServiceImpl } from './AIAssistantServiceImpl';

// TODO service
export {
  TodoServiceImpl,
  createTodoService,
  type TodoServiceConfig,
} from './TodoServiceImpl';

// Notes service
export { NotesServiceImpl } from './NotesServiceImpl';

// Document service (headless content API for AI tools)
export { DocumentServiceImpl } from './DocumentServiceImpl';
export { NoteCollaborationServiceImpl } from './NoteCollaborationServiceImpl';

// Capture service (global quick-capture)
export { CaptureServiceImpl } from './CaptureServiceImpl';

// Operation service
export { OperationServiceImpl } from './OperationServiceImpl';
export { OperationTemplateRegistry } from './OperationTemplateRegistry';

// Artifact system services
export { ProvenanceServiceImpl } from './ProvenanceServiceImpl';
export { SessionServiceImpl } from './SessionServiceImpl';
export { LineageServiceImpl } from './LineageServiceImpl';
export { CommitmentLineageServiceImpl } from './CommitmentLineageServiceImpl';
export { IndexServiceImpl } from './IndexServiceImpl';
export { BranchServiceImpl } from './BranchServiceImpl';
export { PulseServiceImpl } from './PulseServiceImpl';

// Agent loop
export { AgentLoopServiceImpl } from './AgentLoopServiceImpl';
export { AgentOrchestrationServiceImpl } from './AgentOrchestrationServiceImpl';
export { AgentIntakeServiceImpl } from './AgentIntakeServiceImpl';
export { AgentRunEngine } from './AgentRunEngine';
export { AgentSwarmPlanner, shouldUseSwarmForPrompt, type AgentSwarmPlan } from './AgentSwarmPlanner';
export { AgentWorkerRunner, type AgentWorkerRunInput } from './AgentWorkerRunner';
export { AgentWorkerBus, type WorkerBusMessageInput } from './AgentWorkerBus';
export { AgentWorkerScheduler, type WorkerScheduleResult } from './AgentWorkerScheduler';
export { AgentMergeService, type AgentMergeInput } from './AgentMergeService';
export { ScopedWorkerToolExecutor } from './ScopedWorkerToolExecutor';
export { DeepResearchEvidence } from './DeepResearchEvidence';
export { DeepResearchPipeline, type DeepResearchPipelineResult } from './DeepResearchPipeline';
export { PhaseNarrator } from './PhaseNarrator';
