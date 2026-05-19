/**
 * Logging convenience factory.
 *
 * Provides getLogger(source) for any module to get a scoped logger.
 * Lazily resolves LoggerPort from the DI container.
 * Before bootstrap completes, calls are silent no-ops.
 */

import { createLogEntry } from './domain/values/LogEntry';
import type { LoggerPort } from './ports/outbound/LoggerPort';

let loggerPort: LoggerPort | null = null;

/**
 * Set the logger port instance. Called by bootstrap after registration.
 */
export function setLoggerPort(port: LoggerPort): void {
  loggerPort = port;
}

/**
 * Get the current logger port (or null before bootstrap).
 */
export function getLoggerPort(): LoggerPort | null {
  return loggerPort;
}

/**
 * Get a scoped logger for a given source module.
 *
 * Safe to call before bootstrap — methods are no-ops until the logger is registered.
 *
 * @example
 * ```typescript
 * const log = getLogger('ClaudeAdapter');
 * log.info('Request started', { model: 'claude-3' });
 * log.error('Request failed', { error: err.message });
 * ```
 */
export function getLogger(source: string) {
  return {
    debug: (msg: string, meta?: Record<string, unknown>) =>
      loggerPort?.log(createLogEntry('debug', source, msg, meta)),
    info: (msg: string, meta?: Record<string, unknown>) =>
      loggerPort?.log(createLogEntry('info', source, msg, meta)),
    warn: (msg: string, meta?: Record<string, unknown>) =>
      loggerPort?.log(createLogEntry('warn', source, msg, meta)),
    error: (msg: string, meta?: Record<string, unknown>) =>
      loggerPort?.log(createLogEntry('error', source, msg, meta)),
  };
}
