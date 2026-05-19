/**
 * OperationTemplate - Reusable operation definitions
 *
 * Templates define pre-configured operations with prompt templates,
 * context requirements, and result handling rules.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

import type { OperationType } from './OperationType';

/**
 * What context an operation needs from the note system.
 */
export type ContextRequirementType =
  | 'currentNote'
  | 'folder'
  | 'search'
  | 'allNotes'
  | 'recentNotes';

/**
 * A single context requirement with optional configuration.
 */
export interface ContextRequirement {
  type: ContextRequirementType;
  /** Folder path for 'folder' type */
  folder?: string;
  /** Search query for 'search' type */
  query?: string;
  /** Max results for 'recentNotes' or 'search' */
  limit?: number;
}

/**
 * How to handle operation results.
 */
export interface ResultHandlingConfig {
  /** Automatically apply results without preview */
  autoApply: boolean;
  /** Require user preview before applying */
  previewRequired: boolean;
  /** Create a new note with results */
  createNote: boolean;
  /** Update an existing note */
  updateExisting: boolean;
}

/**
 * Variable definition for template prompts.
 */
export interface TemplateVariable {
  name: string;
  description: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  default?: string | number | boolean;
}

/**
 * Reusable operation template.
 */
export interface OperationTemplate {
  /** Unique template identifier */
  id: string;
  /** Display name */
  name: string;
  /** Description of what this template does */
  description: string;
  /** Operation type */
  type: OperationType;
  /** Prompt template with {{variable}} placeholders */
  promptTemplate: string;
  /** What context is needed */
  contextRequirements: ContextRequirement[];
  /** How to handle results */
  resultHandling: ResultHandlingConfig;
  /** Variable definitions */
  variables: TemplateVariable[];
  /** Estimated duration in ms */
  estimatedDuration?: number;
}

/**
 * Render a prompt template with variable values.
 */
export function renderPromptTemplate(
  template: string,
  variables: Record<string, string | number | boolean>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return key in variables ? String(variables[key]) : `{{${key}}}`;
  });
}
