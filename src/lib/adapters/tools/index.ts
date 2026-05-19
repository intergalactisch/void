/**
 * Tools Adapter exports
 *
 * Infrastructure adapters for tool registration, execution, and management.
 *
 * This module provides:
 * - InMemoryToolRegistryAdapter: Stores tool definitions in memory
 * - ToolExecutorAdapter: Executes tools with cancellation support
 *
 * Tools are now defined via the modular defineTool() system in $lib/tools/.
 *
 * IMPORTANT: Only bootstrap.ts should import from this module directly.
 * Application services should depend on ports (ToolRegistryPort, ToolExecutorPort).
 */

// Adapters
export { InMemoryToolRegistryAdapter } from './InMemoryToolRegistryAdapter';
export { ToolExecutorAdapter } from './ToolExecutorAdapter';
