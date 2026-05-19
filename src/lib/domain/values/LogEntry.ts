/**
 * LogEntry - Value object for structured log entries.
 *
 * Represents a single log entry with level, source, message, and optional metadata.
 * Used by the logging system for both in-memory and file-based persistence.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Severity level */
  level: LogLevel;
  /** Source module (e.g. "ClaudeAdapter", "Bootstrap") */
  source: string;
  /** Human-readable message */
  message: string;
  /** Optional structured data */
  metadata?: Record<string, unknown>;
}

/**
 * Create a new LogEntry with the current timestamp.
 */
export function createLogEntry(
  level: LogLevel,
  source: string,
  message: string,
  metadata?: Record<string, unknown>
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
  };
  if (metadata !== undefined) {
    entry.metadata = metadata;
  }
  return entry;
}
