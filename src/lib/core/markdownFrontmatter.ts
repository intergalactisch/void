/**
 * Markdown frontmatter serialization shared by persistence and export paths.
 */

import type { DocumentMeta } from '$lib/domain/values';
import { normalizeNoteTags } from '$lib/domain/values';

export function extractFrontmatterTags(markdown: string): string[] {
  const data = parseFrontmatterData(markdown);
  const tags = data.tags;

  if (Array.isArray(tags)) {
    return normalizeNoteTags(tags.filter((tag): tag is string => typeof tag === 'string'));
  }

  if (typeof tags === 'string') {
    return normalizeNoteTags(tags.split(','));
  }

  return [];
}

export function serializeMetadataFrontmatter(meta: DocumentMeta): string {
  const data: Record<string, unknown> = {};

  if (meta.title && meta.title !== 'Untitled') {
    data.title = meta.title;
  }

  if (meta.tags && meta.tags.length > 0) {
    data.tags = meta.tags;
  }

  if (meta.category) {
    data.category = meta.category;
  }

  if (meta.color) {
    data.color = meta.color;
  }

  if (meta.pinned) {
    data.pinned = true;
  }

  if (meta.status && meta.status !== 'draft') {
    data.status = meta.status;
  }

  if (meta.intent && meta.intent !== 'general') {
    data.intent = meta.intent;
  }

  if (meta.aiTouches && meta.aiTouches > 0) {
    data.ai_touches = meta.aiTouches;
  }

  data.createdAt = meta.createdAt.toISOString();
  data.updatedAt = meta.updatedAt.toISOString();

  if (meta.custom && Object.keys(meta.custom).length > 0) {
    for (const [key, value] of Object.entries(meta.custom)) {
      data[key] = value;
    }
  }

  const hasContent =
    data.title ||
    data.tags ||
    data.category ||
    data.color ||
    data.pinned ||
    data.status ||
    data.intent ||
    data.ai_touches ||
    (meta.custom && Object.keys(meta.custom).length > 0);

  if (!hasContent && !meta.createdAt) {
    return '';
  }

  return serializeToYaml(data);
}

export function combineMarkdownWithFrontmatter(content: string, meta: DocumentMeta): string {
  return serializeMetadataFrontmatter(meta) + content;
}

function serializeToYaml(data: Record<string, unknown>): string {
  const lines: string[] = ['---'];

  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${serializeYamlValue(item)}`);
      }
    } else {
      lines.push(`${key}: ${serializeYamlValue(value)}`);
    }
  }

  lines.push('---');
  lines.push('');
  return lines.join('\n') + '\n';
}

function serializeYamlValue(value: unknown): string {
  if (typeof value === 'string') {
    if (
      value.includes(':') ||
      value.includes('#') ||
      value.includes('\n') ||
      value.includes('"') ||
      value.includes("'") ||
      value === 'true' ||
      value === 'false' ||
      value === 'null' ||
      /^-?\d+(\.\d+)?$/.test(value)
    ) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value === null) {
    return 'null';
  }

  return JSON.stringify(value);
}

function parseFrontmatterData(input: string): Record<string, unknown> {
  const trimmed = input.trim();
  if (!trimmed.startsWith('---')) return {};

  const endIndex = trimmed.indexOf('\n---', 3);
  if (endIndex === -1) return {};

  return parseSimpleYaml(trimmed.substring(4, endIndex).trim());
}

function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let currentKey: string | null = null;
  let currentArray: unknown[] | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    const arrayMatch = line.match(/^\s+-\s+(.*)$/);
    if (arrayMatch?.[1] !== undefined && currentKey && currentArray) {
      currentArray.push(parseYamlValue(arrayMatch[1].trim()));
      continue;
    }

    if (currentKey && currentArray) {
      result[currentKey] = currentArray;
      currentArray = null;
      currentKey = null;
    }

    const kvMatch = line.match(/^([^:]+):\s*(.*)$/);
    if (kvMatch?.[1] !== undefined && kvMatch[2] !== undefined) {
      const key = kvMatch[1].trim();
      const value = kvMatch[2].trim();

      if (value === '') {
        currentKey = key;
        currentArray = [];
      } else if (value.startsWith('[') && value.endsWith(']')) {
        result[key] = value.slice(1, -1).split(',').map((item) => parseYamlValue(item.trim()));
      } else {
        result[key] = parseYamlValue(value);
      }
    }
  }

  if (currentKey && currentArray) {
    result[currentKey] = currentArray;
  }

  return result;
}

function parseYamlValue(value: string): unknown {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  return value;
}
