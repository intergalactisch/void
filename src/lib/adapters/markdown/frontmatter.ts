/**
 * YAML Frontmatter Handler
 *
 * Parses and serializes YAML frontmatter from markdown files.
 * Frontmatter is used to store document metadata like title, tags,
 * category, and timestamps.
 *
 * Part of the Markdown infrastructure adapter.
 *
 * Note: Uses a simple browser-compatible YAML parser instead of gray-matter
 * to avoid Node.js Buffer dependency issues in Tauri/browser environments.
 */

import { serializeMetadataFrontmatter } from '$lib/core';
import type { DocumentMeta } from '$lib/domain/values';
import { normalizeNoteTags } from '$lib/domain/values';
import { isValidIntent } from '$lib/domain/values/NoteIntent';
import { isValidStatus } from '$lib/domain/values/NoteStatus';
import {
  PROTECTED_FRONTMATTER_KEYS,
  protectionMetaFromCustom,
} from '$lib/domain/values/Protection';

/**
 * Result of parsing markdown with frontmatter
 */
export interface ParsedMarkdown {
  /** The markdown content without frontmatter */
  content: string;
  /** Extracted metadata (partial, to be merged with defaults) */
  meta: Partial<DocumentMeta>;
}

/**
 * Known frontmatter keys that map to DocumentMeta
 */
const KNOWN_META_KEYS = [
  'title',
  'tags',
  'category',
  'color',
  'createdAt',
  'updatedAt',
  'pinned',
  'id',
  'status',
  'intent',
  'ai_touches',
  PROTECTED_FRONTMATTER_KEYS.level,
  PROTECTED_FRONTMATTER_KEYS.noteId,
  PROTECTED_FRONTMATTER_KEYS.keyId,
  PROTECTED_FRONTMATTER_KEYS.algorithm,
  PROTECTED_FRONTMATTER_KEYS.version,
  PROTECTED_FRONTMATTER_KEYS.protectedAt,
  PROTECTED_FRONTMATTER_KEYS.titleVisible,
] as const;

/**
 * Parse markdown content with YAML frontmatter
 *
 * @param markdown - The full markdown string including frontmatter
 * @returns Parsed content and metadata
 *
 * @example
 * ```typescript
 * const result = parseMarkdownWithFrontmatter(`---
 * title: My Note
 * tags: [work, important]
 * ---
 *
 * # My Note Content
 * `);
 *
 * console.log(result.meta.title); // 'My Note'
 * console.log(result.meta.tags);  // ['work', 'important']
 * console.log(result.content);    // '# My Note Content'
 * ```
 */
export function parseMarkdownWithFrontmatter(markdown: string): ParsedMarkdown {
  try {
    const { content, data } = parseFrontmatter(markdown);

    return {
      content: content.trim(),
      meta: extractDocumentMeta(data),
    };
  } catch (error) {
    // If frontmatter parsing fails, return the content as-is
    console.warn('Failed to parse frontmatter:', error);
    return {
      content: markdown.trim(),
      meta: {},
    };
  }
}

/**
 * Simple browser-compatible frontmatter parser
 * Handles basic YAML without needing Node.js Buffer
 */
function parseFrontmatter(input: string): { content: string; data: Record<string, unknown> } {
  const trimmed = input.trim();

  // Check if content starts with frontmatter delimiter
  if (!trimmed.startsWith('---')) {
    return { content: input, data: {} };
  }

  // Find the closing delimiter
  const endIndex = trimmed.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { content: input, data: {} };
  }

  // Extract frontmatter YAML and content
  const yamlStr = trimmed.substring(4, endIndex).trim();
  const content = trimmed.substring(endIndex + 4).trim();

  // Parse simple YAML
  const data = parseSimpleYaml(yamlStr);

  return { content, data };
}

/**
 * Parse simple YAML (key: value pairs, arrays, booleans, numbers)
 * This is intentionally limited to what we need for frontmatter.
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');

  let currentKey: string | null = null;
  let currentArray: unknown[] | null = null;

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    // Check for array item (indented with -)
    const arrayMatch = line.match(/^\s+-\s+(.*)$/);
    if (arrayMatch?.[1] !== undefined && currentKey && currentArray) {
      currentArray.push(parseYamlValue(arrayMatch[1].trim()));
      continue;
    }

    // If we were building an array, save it
    if (currentKey && currentArray) {
      result[currentKey] = currentArray;
      currentArray = null;
      currentKey = null;
    }

    // Check for key: value pair
    const kvMatch = line.match(/^([^:]+):\s*(.*)$/);
    if (kvMatch?.[1] !== undefined && kvMatch[2] !== undefined) {
      const key = kvMatch[1].trim();
      const value = kvMatch[2].trim();

      if (value === '') {
        // Could be start of array or empty value
        currentKey = key;
        currentArray = [];
      } else if (value.startsWith('[') && value.endsWith(']')) {
        // Inline array: [item1, item2]
        const items = value.slice(1, -1).split(',').map(s => parseYamlValue(s.trim()));
        result[key] = items;
      } else {
        result[key] = parseYamlValue(value);
      }
    }
  }

  // Don't forget the last array if any
  if (currentKey && currentArray) {
    result[currentKey] = currentArray;
  }

  return result;
}

/**
 * Parse a single YAML value (string, number, boolean, null)
 */
function parseYamlValue(value: string): unknown {
  // Remove surrounding quotes if present
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Booleans
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Null
  if (value === 'null' || value === '~') return null;

  // Numbers
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);

  // Default to string
  return value;
}

/**
 * Extract DocumentMeta fields from raw frontmatter data
 */
function extractDocumentMeta(data: Record<string, unknown>): Partial<DocumentMeta> {
  const meta: Partial<DocumentMeta> = {};

  // ID (string)
  if (typeof data.id === 'string' && data.id.length > 0) {
    meta.id = data.id;
  }

  // Title (string)
  if (typeof data.title === 'string' && data.title.length > 0) {
    meta.title = data.title;
  }

  // Tags (array of strings)
  if (Array.isArray(data.tags)) {
    meta.tags = normalizeNoteTags(data.tags.filter((tag): tag is string => typeof tag === 'string'));
  } else if (typeof data.tags === 'string') {
    // Support comma-separated string format
    meta.tags = normalizeNoteTags(data.tags.split(','));
  }

  // Category (string or null)
  if (typeof data.category === 'string' && data.category.length > 0) {
    meta.category = data.category;
  } else {
    meta.category = null;
  }

  // Color (string or null)
  if (typeof data.color === 'string' && data.color.length > 0) {
    meta.color = data.color;
  } else {
    meta.color = null;
  }

  // Created timestamp
  if (data.createdAt) {
    const date = parseDate(data.createdAt);
    if (date) {
      meta.createdAt = date;
    }
  }

  // Updated timestamp
  if (data.updatedAt) {
    const date = parseDate(data.updatedAt);
    if (date) {
      meta.updatedAt = date;
    }
  }

  // Pinned (boolean)
  if (typeof data.pinned === 'boolean') {
    meta.pinned = data.pinned;
  } else if (data.pinned === 'true' || data.pinned === 1) {
    meta.pinned = true;
  }

  // Status (NoteStatus)
  if (typeof data.status === 'string' && isValidStatus(data.status)) {
    meta.status = data.status;
  }

  // Intent (NoteIntent)
  if (typeof data.intent === 'string' && isValidIntent(data.intent)) {
    meta.intent = data.intent;
  }

  // AI touches (number) — frontmatter uses snake_case
  const aiTouchesRaw = data.ai_touches ?? data.aiTouches;
  if (typeof aiTouchesRaw === 'number' && aiTouchesRaw >= 0) {
    meta.aiTouches = aiTouchesRaw;
  }

  const protectionCustom = {
    [PROTECTED_FRONTMATTER_KEYS.level]: data[PROTECTED_FRONTMATTER_KEYS.level],
    [PROTECTED_FRONTMATTER_KEYS.noteId]: data[PROTECTED_FRONTMATTER_KEYS.noteId],
    [PROTECTED_FRONTMATTER_KEYS.keyId]: data[PROTECTED_FRONTMATTER_KEYS.keyId],
    [PROTECTED_FRONTMATTER_KEYS.algorithm]: data[PROTECTED_FRONTMATTER_KEYS.algorithm],
    [PROTECTED_FRONTMATTER_KEYS.version]: data[PROTECTED_FRONTMATTER_KEYS.version],
    [PROTECTED_FRONTMATTER_KEYS.protectedAt]: data[PROTECTED_FRONTMATTER_KEYS.protectedAt],
    [PROTECTED_FRONTMATTER_KEYS.titleVisible]: data[PROTECTED_FRONTMATTER_KEYS.titleVisible],
  };
  meta.protection = protectionMetaFromCustom(protectionCustom);

  // Custom metadata (everything else, plus persisted protection headers)
  const customKeys = Object.keys(data).filter((key) => {
    if (KNOWN_META_KEYS.includes(key as (typeof KNOWN_META_KEYS)[number])) return false;
    return !Object.values(PROTECTED_FRONTMATTER_KEYS).includes(
      key as (typeof PROTECTED_FRONTMATTER_KEYS)[keyof typeof PROTECTED_FRONTMATTER_KEYS]
    );
  });

  if (customKeys.length > 0) {
    meta.custom = {};
    for (const key of customKeys) {
      meta.custom[key] = data[key];
    }
  }

  return meta;
}

/**
 * Parse a date from various formats
 */
function parseDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'string') {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  return undefined;
}

/**
 * Serialize document metadata to YAML frontmatter
 *
 * @param meta - The document metadata to serialize
 * @returns YAML frontmatter string including delimiters, or empty string if no meaningful data
 *
 * @example
 * ```typescript
 * const frontmatter = serializeFrontmatter({
 *   id: 'doc-123',
 *   title: 'My Note',
 *   tags: ['work'],
 *   category: null,
 *   color: null,
 *   createdAt: new Date('2024-01-01'),
 *   updatedAt: new Date('2024-01-02'),
 *   pinned: false,
 *   custom: {},
 * });
 *
 * // Returns:
 * // ---
 * // title: My Note
 * // tags:
 * //   - work
 * // createdAt: 2024-01-01T00:00:00.000Z
 * // updatedAt: 2024-01-02T00:00:00.000Z
 * // ---
 * ```
 */
export function serializeFrontmatter(meta: DocumentMeta): string {
  return serializeMetadataFrontmatter(meta);
}

/**
 * Combine markdown content with frontmatter
 *
 * @param content - The markdown content (without frontmatter)
 * @param meta - The document metadata
 * @returns Full markdown string with frontmatter prepended
 */
export function combineWithFrontmatter(content: string, meta: DocumentMeta): string {
  const frontmatter = serializeFrontmatter(meta);
  return frontmatter + content;
}

/**
 * Update frontmatter in an existing markdown string
 *
 * @param markdown - The full markdown string
 * @param updates - Partial metadata updates to apply
 * @returns Updated markdown string with new frontmatter
 */
export function updateFrontmatter(
  markdown: string,
  updates: Partial<DocumentMeta>
): string {
  const { content, meta: existingMeta } = parseMarkdownWithFrontmatter(markdown);

  // Merge updates with existing meta
  const now = new Date();
  const mergedMeta: DocumentMeta = {
    id: updates.id ?? existingMeta.id ?? `doc-${Date.now()}`,
    title: updates.title ?? existingMeta.title ?? 'Untitled',
    tags: normalizeNoteTags(updates.tags ?? existingMeta.tags),
    category: updates.category !== undefined ? updates.category : (existingMeta.category ?? null),
    color: updates.color !== undefined ? updates.color : (existingMeta.color ?? null),
    createdAt: existingMeta.createdAt ?? now,
    updatedAt: now, // Always update the updatedAt timestamp
    pinned: updates.pinned ?? existingMeta.pinned ?? false,
    status: updates.status ?? existingMeta.status ?? 'draft',
    intent: updates.intent ?? existingMeta.intent ?? 'general',
    aiTouches: updates.aiTouches ?? existingMeta.aiTouches ?? 0,
    protection: updates.protection ?? existingMeta.protection ?? null,
    custom: { ...existingMeta.custom, ...updates.custom },
  };

  return combineWithFrontmatter(content, mergedMeta);
}
