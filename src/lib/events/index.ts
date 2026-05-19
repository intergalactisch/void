/**
 * Events module - Typed event bus and command infrastructure
 *
 * Exports:
 * - events: mitt-based event bus for broadcasting
 * - Commands: intent types for state changes
 * - Domain Events: fact types for what happened
 * - Queue: ResourceLock for per-resource sequential processing
 */

// Event bus
export { events } from './bus';
export type { EventMap, Settings } from './types';

// Commands
export {
  createCommand,
  commandSuccess,
  commandFailure,
  isNoteCommand,
  isDocumentCommand,
} from './commands';
export type {
  Command,
  CommandResult,
  CommandHandler,
  NoteCommand,
  NoteCreateCommand,
  NoteCreateQuickCommand,
  NoteSaveCommand,
  NoteDeleteCommand,
  NoteRenameCommand,
  NoteOpenCommand,
  NoteCloseCommand,
  DocumentCommand,
  DocumentSaveCommand,
  AppCommand,
} from './commands';

// Domain Events
export {
  createDomainEvent,
  isNoteEvent,
  isCommandLifecycleEvent,
} from './domain-events';
export type {
  DomainEvent,
  DomainEventMap,
  DomainEventListener,
  NoteEvent,
  NoteCreatedEvent,
  NoteSavedEvent,
  NoteDeletedEvent,
  NoteRenamedEvent,
  NoteOpenedEvent,
  NoteClosedEvent,
  CommandLifecycleEvent,
  CommandStartedEvent,
  CommandCompletedEvent,
  CommandFailedEvent,
  AppDomainEvent,
} from './domain-events';

// Queue infrastructure
export {
  ResourceLock,
  resourceLock,
} from './queue';
export type {
  ReleaseLock,
  ResourceLockOwner,
  ResourceLockSnapshot,
  ResourceLockChangeReason,
} from './queue';

// CommandBus (high-level API)
export { CommandBus, createCommandBus } from './CommandBus';
export type { CommandBusOptions } from './CommandBus';
