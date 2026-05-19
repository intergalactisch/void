/**
 * Commands Adapter exports
 *
 * Infrastructure adapter for command registration and management.
 */

// Main adapter
export { CommandRegistryAdapter, commandRegistry } from './CommandRegistryAdapter';

// Registry utilities (for testing or advanced use)
export {
  registerCommand,
  unregisterCommand,
  getAllCommands,
  getCommand,
  searchCommands,
  getCommandsGrouped,
  clearCommands,
  getCommandCount,
} from './registry';

// Built-in commands
export { createBuiltinCommands, registerBuiltinCommands } from './builtinCommands';
export { createGlobalCommands, registerGlobalCommands } from './globalCommands';
