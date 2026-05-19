/**
 * Tool - Application tool definition
 *
 * A Tool represents a capability the application exposes that can be
 * invoked by the AI or other parts of the system. Tools are registered
 * with the ToolRegistry and have a well-defined interface.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

import type { ToolId, ToolNamespace } from '../values/ToolId';

/**
 * JSON Schema-like parameter definition.
 * Simplified subset of JSON Schema for tool parameters.
 */
export interface ParameterSchema {
  /** Parameter type */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  /** Human-readable description */
  description: string;
  /** Whether this parameter is required */
  required?: boolean;
  /** Default value if not provided */
  default?: unknown;
  /** Allowed values (for enums) */
  enum?: unknown[];
  /** Min value (for numbers) */
  minimum?: number;
  /** Max value (for numbers) */
  maximum?: number;
  /** Min length (for strings/arrays) */
  minLength?: number;
  /** Max length (for strings/arrays) */
  maxLength?: number;
  /** Pattern (for strings) */
  pattern?: string;
  /** Item schema (for arrays) */
  items?: ParameterSchema;
  /** Property schemas (for objects) */
  properties?: Record<string, ParameterSchema>;
}

/**
 * Tool category for organization and filtering.
 */
export type ToolCategory =
  | 'note'          // Note operations
  | 'editor'        // Editor manipulation
  | 'search'        // Search functionality
  | 'navigation'    // Navigation
  | 'todo'          // Todo operations
  | 'content'       // Content generation
  | 'transform'     // Content transformation
  | 'intelligence'  // Cross-note analysis
  | 'fs'            // File system (CLI-exclusive)
  | 'system'        // System operations
  | 'ai'            // AI-specific tools
  | 'custom';       // User-defined

/**
 * Tool definition.
 */
export interface Tool {
  /** Unique tool identifier */
  id: ToolId;

  /** Human-readable name */
  name: string;

  /** Description of what the tool does (for AI) */
  description: string;

  /** Category for organization */
  category: ToolCategory;

  /** Parameter definitions */
  parameters: Record<string, ParameterSchema>;

  /** Whether this tool is currently available */
  enabled: boolean;

  /** Whether tool execution should be confirmed by user */
  requiresConfirmation: boolean;

  /** Keywords for search/matching */
  keywords: string[];

  /** Example usage phrases (for AI training) */
  examples: string[];

  /** Estimated execution time in ms (for UI feedback) */
  estimatedDuration?: number;
}

/**
 * Create a tool definition.
 */
export function createTool(params: {
  id: ToolId;
  name: string;
  description: string;
  category: ToolCategory;
  parameters?: Record<string, ParameterSchema>;
  requiresConfirmation?: boolean;
  keywords?: string[];
  examples?: string[];
  estimatedDuration?: number;
}): Tool {
  const tool: Tool = {
    id: params.id,
    name: params.name,
    description: params.description,
    category: params.category,
    parameters: params.parameters ?? {},
    enabled: true,
    requiresConfirmation: params.requiresConfirmation ?? false,
    keywords: params.keywords ?? [],
    examples: params.examples ?? [],
  };

  if (params.estimatedDuration !== undefined) {
    tool.estimatedDuration = params.estimatedDuration;
  }

  return tool;
}

/**
 * Get required parameters for a tool.
 */
export function getRequiredParameters(tool: Tool): string[] {
  return Object.entries(tool.parameters)
    .filter(([, schema]) => schema.required)
    .map(([name]) => name);
}

/**
 * Check if a tool has all required parameters provided.
 */
export function hasRequiredParameters(
  tool: Tool,
  args: Record<string, unknown>
): boolean {
  const required = getRequiredParameters(tool);
  return required.every((param) => param in args && args[param] !== undefined);
}

/**
 * Get missing required parameters.
 */
export function getMissingParameters(
  tool: Tool,
  args: Record<string, unknown>
): string[] {
  const required = getRequiredParameters(tool);
  return required.filter((param) => !(param in args) || args[param] === undefined);
}

/**
 * Validate a parameter value against its schema.
 * Returns error message or null if valid.
 */
export function validateParameter(
  schema: ParameterSchema,
  value: unknown
): string | null {
  // Check type
  const actualType = Array.isArray(value) ? 'array' : typeof value;
  if (actualType !== schema.type) {
    return `Expected ${schema.type}, got ${actualType}`;
  }

  // Type-specific validation
  if (schema.type === 'string' && typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return `String too short (min: ${schema.minLength})`;
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return `String too long (max: ${schema.maxLength})`;
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      return `String does not match pattern: ${schema.pattern}`;
    }
  }

  if (schema.type === 'number' && typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return `Number too small (min: ${schema.minimum})`;
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return `Number too large (max: ${schema.maximum})`;
    }
  }

  if (schema.type === 'array' && Array.isArray(value)) {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return `Array too short (min: ${schema.minLength})`;
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return `Array too long (max: ${schema.maxLength})`;
    }
  }

  // Check enum
  if (schema.enum && !schema.enum.includes(value)) {
    return `Value must be one of: ${schema.enum.join(', ')}`;
  }

  return null;
}

/**
 * Validate all arguments against tool parameters.
 * Returns map of parameter name to error message.
 */
export function validateToolArgs(
  tool: Tool,
  args: Record<string, unknown>
): Record<string, string> {
  const errors: Record<string, string> = {};

  // Check required parameters
  for (const missing of getMissingParameters(tool, args)) {
    errors[missing] = 'Required parameter is missing';
  }

  // Validate provided parameters
  for (const [name, value] of Object.entries(args)) {
    const schema = tool.parameters[name];
    if (schema) {
      const error = validateParameter(schema, value);
      if (error) {
        errors[name] = error;
      }
    }
  }

  return errors;
}

/**
 * Format tool definition for AI system prompt.
 * This creates a structured description the AI can understand.
 */
export function formatToolForAI(tool: Tool): string {
  const lines: string[] = [
    `### ${tool.id}`,
    `Name: ${tool.name}`,
    `Description: ${tool.description}`,
  ];

  if (Object.keys(tool.parameters).length > 0) {
    lines.push('Parameters:');
    for (const [name, schema] of Object.entries(tool.parameters)) {
      const required = schema.required ? ' (required)' : '';
      lines.push(`  - ${name}: ${schema.type}${required} - ${schema.description}`);
    }
  }

  if (tool.examples.length > 0) {
    lines.push('Examples:');
    for (const example of tool.examples) {
      lines.push(`  - "${example}"`);
    }
  }

  return lines.join('\n');
}

/**
 * Match a tool against a search query.
 * Returns a relevance score (0-1).
 */
export function matchTool(tool: Tool, query: string): number {
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return 0;

  const terms = normalizedQuery.split(/\s+/);
  let score = 0;

  // Match against name (highest weight)
  const nameLower = tool.name.toLowerCase();
  if (nameLower.includes(normalizedQuery)) {
    score += 0.5;
  } else if (terms.some((t) => nameLower.includes(t))) {
    score += 0.3;
  }

  // Match against description
  const descLower = tool.description.toLowerCase();
  if (descLower.includes(normalizedQuery)) {
    score += 0.3;
  } else if (terms.some((t) => descLower.includes(t))) {
    score += 0.15;
  }

  // Match against keywords
  const keywordsLower = tool.keywords.map((k) => k.toLowerCase());
  for (const term of terms) {
    if (keywordsLower.includes(term)) {
      score += 0.1;
    } else if (keywordsLower.some((k) => k.includes(term))) {
      score += 0.05;
    }
  }

  return Math.min(1, score);
}
