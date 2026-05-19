/**
 * CommandQueue - Sequential command processor with resource locking
 *
 * The CommandQueue ensures commands are processed in FIFO order,
 * with optional per-resource locking to prevent concurrent modifications
 * to the same resource.
 *
 * Features:
 * - FIFO processing order
 * - Per-resource locking (commands with same resourceId wait for each other)
 * - Commands targeting different resources can process in parallel
 * - Event emission for command lifecycle (started, completed, failed)
 *
 * Usage:
 * ```typescript
 * const queue = new CommandQueue();
 *
 * // Register a handler for a command type
 * queue.registerHandler('note:create', async (command) => {
 *   const note = await createNote(command.payload);
 *   return commandSuccess(command.id, note);
 * });
 *
 * // Dispatch a command
 * const result = await queue.dispatch(createCommand('note:create', { title: 'Hello' }));
 * ```
 */

import type { Command, CommandResult, CommandHandler } from '../commands';
import { commandFailure } from '../commands';
import { ResourceLock } from './ResourceLock';
import { events } from '../bus';

/**
 * Queue entry for a pending command.
 */
interface QueuedCommand {
  command: Command;
  resolve: (result: CommandResult<unknown>) => void;
}

/**
 * Options for the CommandQueue.
 */
export interface CommandQueueOptions {
  /** Whether to emit lifecycle events (default: true) */
  emitLifecycleEvents?: boolean;
  /** Whether to log commands in development mode (default: true) */
  devLogging?: boolean;
}

/**
 * CommandQueue processes commands sequentially with optional resource locking.
 *
 * Commands with the same resourceId are processed sequentially.
 * Commands with different resourceIds (or no resourceId) can process in parallel.
 */
export class CommandQueue {
  /** Handlers registered for each command type */
  private handlers = new Map<string, CommandHandler<Command, unknown>>();

  /** Queue of commands waiting to be processed (for commands without resourceId) */
  private globalQueue: QueuedCommand[] = [];

  /** Resource lock for per-resource sequential processing */
  private resourceLock = new ResourceLock();

  /** Whether the global queue is currently processing */
  private isProcessingGlobal = false;

  /** Configuration options */
  private options: Required<CommandQueueOptions>;

  constructor(options: CommandQueueOptions = {}) {
    this.options = {
      emitLifecycleEvents: options.emitLifecycleEvents ?? true,
      devLogging: options.devLogging ?? true,
    };
  }

  /**
   * Register a handler for a command type.
   *
   * Only one handler can be registered per command type.
   *
   * @param type - Command type to handle (e.g., 'note:create')
   * @param handler - Handler function
   */
  registerHandler<TCommand extends Command, TResult>(
    type: TCommand['type'],
    handler: CommandHandler<TCommand, TResult>
  ): void {
    if (this.handlers.has(type)) {
      console.warn(`[CommandQueue] Overwriting handler for command type: ${type}`);
    }
    this.handlers.set(type, handler as CommandHandler<Command, unknown>);
  }

  /**
   * Check if a handler is registered for a command type.
   */
  hasHandler(type: string): boolean {
    return this.handlers.has(type);
  }

  /**
   * Dispatch a command for processing.
   *
   * If the command has a resourceId, it will be processed with resource locking.
   * Otherwise, it will be queued in the global queue.
   *
   * @param command - Command to dispatch
   * @returns Promise that resolves with the command result
   */
  async dispatch<TResult = void>(command: Command): Promise<CommandResult<TResult>> {
    const handler = this.handlers.get(command.type);

    if (!handler) {
      const error = new Error(`No handler registered for command type: ${command.type}`);
      return commandFailure(command.id, error);
    }

    // Log in development
    if (this.options.devLogging && import.meta.env.DEV) {
      console.log(`[CommandQueue] Dispatching: ${command.type}`, command.payload);
    }

    // If command has a resource, use resource locking
    if (command.resourceId) {
      return this.processWithLock(command, handler);
    }

    // Otherwise, use global queue
    return this.enqueueGlobal(command, handler);
  }

  /**
   * Process a command with resource locking.
   */
  private async processWithLock<TResult>(
    command: Command,
    handler: CommandHandler<Command, unknown>
  ): Promise<CommandResult<TResult>> {
    const resourceId = command.resourceId!;

    return this.resourceLock.withLock(resourceId, async () => {
      return this.executeCommand(command, handler);
    });
  }

  /**
   * Enqueue a command in the global queue.
   */
  private enqueueGlobal<TResult>(
    command: Command,
    handler: CommandHandler<Command, unknown>
  ): Promise<CommandResult<TResult>> {
    return new Promise((resolve) => {
      this.globalQueue.push({
        command,
        resolve: resolve as (result: CommandResult<unknown>) => void,
      });

      // Start processing if not already
      if (!this.isProcessingGlobal) {
        this.processGlobalQueue();
      }
    });
  }

  /**
   * Process the global queue sequentially.
   */
  private async processGlobalQueue(): Promise<void> {
    if (this.isProcessingGlobal) return;
    this.isProcessingGlobal = true;

    while (this.globalQueue.length > 0) {
      const entry = this.globalQueue.shift()!;
      const handler = this.handlers.get(entry.command.type)!;

      const result = await this.executeCommand(entry.command, handler);
      entry.resolve(result);
    }

    this.isProcessingGlobal = false;
  }

  /**
   * Execute a single command with lifecycle events.
   */
  private async executeCommand<TResult>(
    command: Command,
    handler: CommandHandler<Command, unknown>
  ): Promise<CommandResult<TResult>> {
    // Emit started event
    if (this.options.emitLifecycleEvents) {
      events.emit('command:started', {
        commandId: command.id,
        commandType: command.type,
        resourceId: command.resourceId,
      });
    }

    try {
      const result = await handler(command);

      // Emit completed/failed event
      if (this.options.emitLifecycleEvents) {
        if (result.success) {
          events.emit('command:completed', {
            commandId: command.id,
            commandType: command.type,
            resourceId: command.resourceId,
          });
        } else {
          events.emit('command:failed', {
            commandId: command.id,
            commandType: command.type,
            error: result.error.message,
            resourceId: command.resourceId,
          });
        }
      }

      return result as CommandResult<TResult>;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // Emit failed event
      if (this.options.emitLifecycleEvents) {
        events.emit('command:failed', {
          commandId: command.id,
          commandType: command.type,
          error: err.message,
          resourceId: command.resourceId,
        });
      }

      return commandFailure(command.id, err);
    }
  }

  /**
   * Get the number of commands waiting in the global queue.
   */
  get pendingCount(): number {
    return this.globalQueue.length;
  }

  /**
   * Check if a resource is currently locked.
   */
  isResourceLocked(resourceId: string): boolean {
    return this.resourceLock.isLocked(resourceId);
  }

  /**
   * Get queue length for a specific resource.
   */
  resourceQueueLength(resourceId: string): number {
    return this.resourceLock.queueLength(resourceId);
  }

  /**
   * Clear all handlers and queues.
   * Use only for testing or cleanup.
   */
  clear(): void {
    this.handlers.clear();
    this.globalQueue = [];
    this.resourceLock.clear();
    this.isProcessingGlobal = false;
  }
}

/**
 * Default singleton instance for application-wide command processing.
 */
export const commandQueue = new CommandQueue();
