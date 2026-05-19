/**
 * Command Queue Infrastructure
 *
 * Exports:
 * - ResourceLock: Per-resource mutex for preventing concurrent modifications
 * - CommandQueue: Sequential command processor with resource locking
 */

export {
  ResourceLock,
  resourceLock,
  type ReleaseLock,
  type ResourceLockOwner,
  type ResourceLockSnapshot,
  type ResourceLockChangeReason,
} from './ResourceLock';
export { CommandQueue, commandQueue, type CommandQueueOptions } from './CommandQueue';
