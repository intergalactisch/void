/**
 * Domain Events - Facts about what happened in the application
 *
 * Domain events are immutable facts. They represent something that
 * has already happened and cannot fail. They are broadcast to all
 * interested listeners.
 *
 * Unlike commands (which are requests), events are notifications.
 */

import type { Document } from '$lib/domain';

/**
 * Base domain event structure.
 * All events have a unique ID, type, payload, and timestamp.
 */
export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  /** Unique identifier for this event instance */
  id: string;
  /** Event type (e.g., 'note:created') */
  type: TType;
  /** Event payload with operation-specific data */
  payload: TPayload;
  /** Timestamp when the event occurred */
  occurredAt: Date;
  /** ID of the command that caused this event (for tracing) */
  causedBy?: string | undefined;
}

/**
 * Create a new domain event with auto-generated ID and timestamp.
 */
export function createDomainEvent<TType extends string, TPayload>(
  type: TType,
  payload: TPayload,
  causedBy?: string
): DomainEvent<TType, TPayload> {
  return {
    id: crypto.randomUUID(),
    type,
    payload,
    occurredAt: new Date(),
    causedBy,
  };
}

// ============================================================================
// Note Events
// ============================================================================

/** A note was created */
export type NoteCreatedEvent = DomainEvent<
  'note:created',
  {
    path: string;
    document: Document;
    source: 'user' | 'ai' | 'system';
  }
>;

/** A note was saved */
export type NoteSavedEvent = DomainEvent<
  'note:saved',
  {
    path: string;
    savedAt: Date;
    source: 'user' | 'ai' | 'system';
  }
>;

/** A note was deleted */
export type NoteDeletedEvent = DomainEvent<
  'note:deleted',
  {
    path: string;
    source: 'user' | 'ai' | 'system';
  }
>;

/** A note was restored from Trash */
export type NoteRestoredEvent = DomainEvent<
  'note:restored',
  {
    path: string;
    document: Document;
    trashId: string;
    source: 'user' | 'ai' | 'system';
  }
>;

/** A note was renamed */
export type NoteRenamedEvent = DomainEvent<
  'note:renamed',
  {
    oldPath: string;
    newPath: string;
    newTitle: string;
    source: 'user' | 'ai' | 'system';
  }
>;

/** A note was opened for editing */
export type NoteOpenedEvent = DomainEvent<
  'note:opened',
  {
    path: string;
    document: Document;
  }
>;

/** A note was closed */
export type NoteClosedEvent = DomainEvent<
  'note:closed',
  {
    path: string;
  }
>;

// ============================================================================
// Command Lifecycle Events
// ============================================================================

/** A command started processing */
export type CommandStartedEvent = DomainEvent<
  'command:started',
  {
    commandId: string;
    commandType: string;
    resourceId?: string;
  }
>;

/** A command completed successfully */
export type CommandCompletedEvent = DomainEvent<
  'command:completed',
  {
    commandId: string;
    commandType: string;
    resourceId?: string;
  }
>;

/** A command failed */
export type CommandFailedEvent = DomainEvent<
  'command:failed',
  {
    commandId: string;
    commandType: string;
    error: string;
    resourceId?: string;
  }
>;

// ============================================================================
// Union Types
// ============================================================================

/** All note-related events */
export type NoteEvent =
  | NoteCreatedEvent
  | NoteSavedEvent
  | NoteDeletedEvent
  | NoteRestoredEvent
  | NoteRenamedEvent
  | NoteOpenedEvent
  | NoteClosedEvent;

/** All command lifecycle events */
export type CommandLifecycleEvent =
  | CommandStartedEvent
  | CommandCompletedEvent
  | CommandFailedEvent;

/** All domain events in the system */
export type AppDomainEvent = NoteEvent | CommandLifecycleEvent;

// ============================================================================
// Domain Event Map (for mitt typing)
// ============================================================================

/**
 * Map of domain event types to their payloads.
 * Used for typing the domain event bus.
 */
export type DomainEventMap = {
  'note:created': NoteCreatedEvent['payload'];
  'note:saved': NoteSavedEvent['payload'];
  'note:deleted': NoteDeletedEvent['payload'];
  'note:restored': NoteRestoredEvent['payload'];
  'note:renamed': NoteRenamedEvent['payload'];
  'note:opened': NoteOpenedEvent['payload'];
  'note:closed': NoteClosedEvent['payload'];
  'command:started': CommandStartedEvent['payload'];
  'command:completed': CommandCompletedEvent['payload'];
  'command:failed': CommandFailedEvent['payload'];
};

// ============================================================================
// Event Listener Types
// ============================================================================

/**
 * Listener function for domain events.
 */
export type DomainEventListener<TEvent extends DomainEvent> = (event: TEvent) => void;

// ============================================================================
// Type Guards
// ============================================================================

/** Check if an event is a note event */
export function isNoteEvent(event: DomainEvent): event is NoteEvent {
  return event.type.startsWith('note:');
}

/** Check if an event is a command lifecycle event */
export function isCommandLifecycleEvent(event: DomainEvent): event is CommandLifecycleEvent {
  return event.type.startsWith('command:');
}
