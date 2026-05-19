/**
 * Command Types - Intents to change application state
 *
 * Commands are requests to perform actions. They are validated,
 * queued, and processed sequentially to prevent race conditions.
 *
 * Unlike events (which are facts about what happened), commands
 * are instructions that may succeed or fail.
 */

/**
 * Base command structure.
 * All commands have a unique ID, type, and payload.
 */
export interface Command<TType extends string = string, TPayload = unknown> {
  /** Unique identifier for this command instance */
  id: string;
  /** Command type (e.g., 'note:create') */
  type: TType;
  /** Command payload with operation-specific data */
  payload: TPayload;
  /** Timestamp when the command was created */
  createdAt: Date;
  /** Resource this command operates on (for locking) */
  resourceId?: string | undefined;
}

/**
 * Create a new command with auto-generated ID and timestamp.
 */
export function createCommand<TType extends string, TPayload>(
  type: TType,
  payload: TPayload,
  resourceId?: string
): Command<TType, TPayload> {
  return {
    id: crypto.randomUUID(),
    type,
    payload,
    createdAt: new Date(),
    resourceId,
  };
}

// ============================================================================
// Note Commands
// ============================================================================

/** Create a new note */
export type NoteCreateCommand = Command<
  'note:create',
  {
    folder: string;
    title: string;
  }
>;

/** Create a quick note with auto-generated title */
export type NoteCreateQuickCommand = Command<
  'note:create-quick',
  {
    folder: string;
  }
>;

/** Save a note's content */
export type NoteSaveCommand = Command<
  'note:save',
  {
    path: string;
  }
>;

/** Delete a note */
export type NoteDeleteCommand = Command<
  'note:delete',
  {
    path: string;
  }
>;

/** Rename a note */
export type NoteRenameCommand = Command<
  'note:rename',
  {
    path: string;
    newTitle: string;
  }
>;

/** Open a note for editing */
export type NoteOpenCommand = Command<
  'note:open',
  {
    path: string;
  }
>;

/** Close the currently open note */
export type NoteCloseCommand = Command<
  'note:close',
  {
    path: string;
  }
>;

// ============================================================================
// Document Commands
// ============================================================================

/** Save the current document in the editor */
export type DocumentSaveCommand = Command<
  'document:save',
  {
    path: string;
  }
>;

// ============================================================================
// Union Types
// ============================================================================

/** All note-related commands */
export type NoteCommand =
  | NoteCreateCommand
  | NoteCreateQuickCommand
  | NoteSaveCommand
  | NoteDeleteCommand
  | NoteRenameCommand
  | NoteOpenCommand
  | NoteCloseCommand;

/** All document-related commands */
export type DocumentCommand = DocumentSaveCommand;

/** All commands in the system */
export type AppCommand = NoteCommand | DocumentCommand;

// ============================================================================
// Command Result
// ============================================================================

/**
 * Result of command execution.
 * Commands can succeed with a value or fail with an error.
 */
export type CommandResult<T = void> =
  | { success: true; value: T; commandId: string }
  | { success: false; error: Error; commandId: string };

/**
 * Create a successful command result.
 */
export function commandSuccess<T>(commandId: string, value: T): CommandResult<T> {
  return { success: true, value, commandId };
}

/**
 * Create a failed command result.
 */
export function commandFailure(commandId: string, error: Error): CommandResult<never> {
  return { success: false, error, commandId };
}

// ============================================================================
// Command Handler Type
// ============================================================================

/**
 * Handler function for processing a specific command type.
 * Receives the command and returns a result.
 */
export type CommandHandler<TCommand extends Command, TResult = void> = (
  command: TCommand
) => Promise<CommandResult<TResult>>;

// ============================================================================
// Type Guards
// ============================================================================

/** Check if a command is a note command */
export function isNoteCommand(command: Command): command is NoteCommand {
  return command.type.startsWith('note:');
}

/** Check if a command is a document command */
export function isDocumentCommand(command: Command): command is DocumentCommand {
  return command.type.startsWith('document:');
}
