/**
 * System Prompt Builder - Constructs system prompts for AI assistants
 *
 * Builds comprehensive system prompts that describe Void's capabilities,
 * available tools, and current context. The prompt instructs the AI on
 * when to use tools versus provide direct responses.
 *
 * Part of the Hexagonal Architecture adapters layer.
 */

import type { Tool, ParameterSchema } from '$lib/domain/entities/Tool';
import type { PromptContext } from '$lib/domain/values/PromptContext';

/**
 * Options for building the system prompt.
 */
export interface SystemPromptOptions {
  /** Include tool definitions in the prompt */
  includeTools?: boolean;
  /** Include current context in the prompt */
  includeContext?: boolean;
  /** Custom instructions to append */
  customInstructions?: string;
}

/**
 * Build the complete system prompt for the AI assistant.
 *
 * @param tools - Available tools the AI can invoke
 * @param context - Current application context
 * @param options - Build options
 * @returns Complete system prompt string
 */
export function buildSystemPrompt(
  tools: Tool[],
  context: PromptContext,
  options: SystemPromptOptions = {}
): string {
  const { includeTools = true, includeContext = true, customInstructions } = options;

  const sections: string[] = [
    buildIdentitySection(),
    buildCapabilitiesSection(),
  ];

  if (includeTools && tools.length > 0) {
    sections.push(buildToolsSection(tools));
  }

  if (includeContext) {
    sections.push(buildContextSection(context));
  }

  sections.push(buildGuidelinesSection());

  if (customInstructions) {
    sections.push(`## Custom Instructions\n\n${customInstructions}`);
  }

  return sections.join('\n\n');
}

/**
 * Build the identity section of the system prompt.
 */
function buildIdentitySection(): string {
  return `# Void AI Assistant

You are the AI assistant for Void, a note-taking application designed for clarity and focus. Your role is to help users manage their notes, find information, and work more effectively.`;
}

/**
 * Build the capabilities section.
 */
function buildCapabilitiesSection(): string {
  return `## Capabilities

You can:
- Create, read, update, and delete notes
- Search through notes by title or content
- Format and edit text in the editor
- Navigate between different views
- Answer questions about the user's notes
- Help with writing, summarizing, and organizing content

You should:
- Be concise and helpful
- Use tools when the user wants to perform an action
- Respond conversationally when the user asks a question
- Explain what you're doing when using tools`;
}

/**
 * Build the tools section with structured tool definitions.
 */
function buildToolsSection(tools: Tool[]): string {
  const enabledTools = tools.filter(t => t.enabled);

  if (enabledTools.length === 0) {
    return `## Available Tools\n\nNo tools are currently available.`;
  }

  const toolDescriptions = enabledTools.map(formatToolDefinition).join('\n\n');

  return `## Available Tools

You have access to the following tools. Use them by including tool calls in your response.

${toolDescriptions}`;
}

/**
 * Format a single tool definition for the system prompt.
 */
function formatToolDefinition(tool: Tool): string {
  const lines: string[] = [
    `### ${tool.name}`,
    `**Tool ID:** \`${tool.id}\``,
    `**Description:** ${tool.description}`,
  ];

  // Add parameters
  const params = Object.entries(tool.parameters);
  if (params.length > 0) {
    lines.push('**Parameters:**');
    for (const [name, schema] of params) {
      const required = schema.required ? ' *(required)*' : '';
      const defaultVal = schema.default !== undefined ? ` (default: ${JSON.stringify(schema.default)})` : '';
      lines.push(`- \`${name}\` (${schema.type})${required}: ${schema.description}${defaultVal}`);
    }
  } else {
    lines.push('**Parameters:** None');
  }

  // Add examples if available
  if (tool.examples.length > 0) {
    lines.push('**Example phrases:**');
    for (const example of tool.examples.slice(0, 3)) {
      lines.push(`- "${example}"`);
    }
  }

  // Note if confirmation is required
  if (tool.requiresConfirmation) {
    lines.push('*This tool requires user confirmation before execution.*');
  }

  return lines.join('\n');
}

/**
 * Build the context section describing current application state.
 */
function buildContextSection(context: PromptContext): string {
  const lines: string[] = ['## Current Context'];

  // Current note
  if (context.currentNote) {
    lines.push(`\n**Current Note:** "${context.currentNote.meta.title}"`);

    if (context.editor) {
      if (context.editor.selectedText) {
        // Truncate long selections
        const selection = context.editor.selectedText.length > 200
          ? context.editor.selectedText.slice(0, 200) + '...'
          : context.editor.selectedText;
        lines.push(`**Selected Text:** "${selection}"`);
      }
      lines.push(`**Word Count:** ${context.editor.wordCount}`);
    }
  } else {
    lines.push('\n**Current Note:** None (no note is open)');
  }

  // Navigation
  lines.push(`**Current View:** ${context.navigation.currentView}`);

  // Recent notes
  if (context.recentNotes.length > 0) {
    const recentTitles = context.recentNotes.slice(0, 5).map(n => `"${n.title}"`).join(', ');
    lines.push(`**Recent Notes:** ${recentTitles}`);
  }

  if (context.references.length > 0) {
    lines.push('\n**Explicit RefIds:**');
    for (const reference of context.references) {
      lines.push(`- ${reference.refId} [${reference.status}] ${reference.label}: ${reference.summary}`);
      if (reference.content) {
        lines.push(`  Content: ${reference.content}`);
      }
    }
  }

  // Time context
  const now = new Date();
  const timeStr = now.toLocaleString('en-US', {
    timeZone: context.timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  lines.push(`**Current Time:** ${timeStr}`);
  lines.push(`**User Language:** ${context.language}`);

  return lines.join('\n');
}

/**
 * Build the guidelines section for AI behavior.
 */
function buildGuidelinesSection(): string {
  return `## Guidelines

### When to Use Tools
- Use tools when the user explicitly asks to perform an action (create, delete, search, etc.)
- Use tools when you need to retrieve information from the user's notes
- Do NOT use tools for general conversation or answering questions from your own knowledge
- For "create a note about X", write useful initial markdown content yourself, then call \`note:create\` with a title, content, and any relevant tags.
- For note updates, prefer \`editor:replace-block\`, \`editor:insert-blocks\`, or \`editor:apply-note-patch\` when an active note is open; otherwise use \`note:update\`.
- For todos, use \`todo:create\` for new tasks, \`todo:update\` for text changes, and \`todo:toggle\` to mark analyzed tasks complete or reopen them.
- For broad research, current facts, multi-note clusters, source gathering, or cross-note synthesis, start durable agent work rather than trying to compress everything into one chat answer.

### When to Respond Directly
- Answer questions about how to use Void
- Provide writing assistance or suggestions
- Engage in general conversation
- Clarify ambiguous requests before taking action

### Tool Safety and Output
- Keep destructive actions explicit and ask for confirmation when the tool requires it.
- Do not invent note paths, todo IDs, URLs, citations, or source titles; search/list/read first when identifiers or evidence are needed.
- When creating related research notes, include wiki links between new notes and only link existing notes that are clearly relevant.
- Keep AI-only execution plans separate from the user's durable todo list unless the user asks to create real follow-up todos.

### Response Format
- Be concise but helpful
- When using tools, briefly explain what you're doing
- If a tool fails, explain the error and suggest alternatives
- Use markdown formatting for clarity when appropriate`;
}

/**
 * Build a minimal system prompt (for token efficiency).
 */
export function buildMinimalSystemPrompt(tools: Tool[]): string {
  const enabledTools = tools.filter(t => t.enabled);

  if (enabledTools.length === 0) {
    return 'You are a helpful AI assistant for a note-taking app called Void.';
  }

  const toolList = enabledTools
    .map(t => `${t.id}: ${t.description}`)
    .join('\n');

  return `You are a helpful AI assistant for Void, a note-taking app.

Available tools:
${toolList}

Use tools when users want to perform actions. Respond directly for questions and conversation.`;
}

/**
 * Convert Tool parameters to Claude's tool input_schema format.
 */
export function convertToolToClaudeFormat(tool: Tool): {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
} {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [name, schema] of Object.entries(tool.parameters)) {
    properties[name] = convertParameterSchema(schema);
    if (schema.required) {
      required.push(name);
    }
  }

  return {
    name: tool.id,
    description: tool.description,
    input_schema: {
      type: 'object',
      properties,
      required,
    },
  };
}

/**
 * Convert internal ParameterSchema to JSON Schema format.
 */
function convertParameterSchema(schema: ParameterSchema): Record<string, unknown> {
  const result: Record<string, unknown> = {
    type: schema.type,
    description: schema.description,
  };

  if (schema.default !== undefined) {
    result.default = schema.default;
  }

  if (schema.enum) {
    result.enum = schema.enum;
  }

  if (schema.type === 'number') {
    if (schema.minimum !== undefined) result.minimum = schema.minimum;
    if (schema.maximum !== undefined) result.maximum = schema.maximum;
  }

  if (schema.type === 'string') {
    if (schema.minLength !== undefined) result.minLength = schema.minLength;
    if (schema.maxLength !== undefined) result.maxLength = schema.maxLength;
    if (schema.pattern) result.pattern = schema.pattern;
  }

  if (schema.type === 'array') {
    if (schema.minLength !== undefined) result.minItems = schema.minLength;
    if (schema.maxLength !== undefined) result.maxItems = schema.maxLength;
    if (schema.items) {
      result.items = convertParameterSchema(schema.items);
    }
  }

  if (schema.type === 'object' && schema.properties) {
    const objProperties: Record<string, unknown> = {};
    for (const [name, propSchema] of Object.entries(schema.properties)) {
      objProperties[name] = convertParameterSchema(propSchema);
    }
    result.properties = objProperties;
  }

  return result;
}

/**
 * Convert all tools to Claude's format for the API request.
 */
export function convertToolsToClaudeFormat(tools: Tool[]): ReturnType<typeof convertToolToClaudeFormat>[] {
  return tools
    .filter(t => t.enabled)
    .map(convertToolToClaudeFormat);
}
