/**
 * RefId - portable references to meaningful Void app objects.
 *
 * RefIds are intentionally readable URI strings so users can paste them into
 * AI prompts while the app can parse them deterministically.
 */

export const REF_ID_SCHEME = 'void://';

export type RefIdKind =
  | 'note'
  | 'folder'
  | 'tag'
  | 'todo'
  | 'block'
  | 'conversation'
  | 'run'
  | 'worker'
  | 'operation';

export type RefId = string & { readonly __brand: 'RefId' };

export interface ParsedRefIdBase {
  readonly raw: RefId;
  readonly kind: RefIdKind;
}

export type ParsedRefId =
  | (ParsedRefIdBase & { readonly kind: 'note'; readonly notePath: string })
  | (ParsedRefIdBase & { readonly kind: 'folder'; readonly folderPath: string })
  | (ParsedRefIdBase & { readonly kind: 'tag'; readonly tag: string })
  | (ParsedRefIdBase & { readonly kind: 'todo'; readonly todoId: string })
  | (ParsedRefIdBase & { readonly kind: 'block'; readonly notePath: string; readonly blockId: string })
  | (ParsedRefIdBase & { readonly kind: 'conversation'; readonly conversationId: string })
  | (ParsedRefIdBase & { readonly kind: 'run'; readonly runId: string })
  | (ParsedRefIdBase & { readonly kind: 'worker'; readonly runId: string; readonly workerId: string })
  | (ParsedRefIdBase & { readonly kind: 'operation'; readonly operationId: string });

export type RefIdInput =
  | { kind: 'note'; notePath: string }
  | { kind: 'folder'; folderPath: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'todo'; todoId: string }
  | { kind: 'block'; notePath: string; blockId: string }
  | { kind: 'conversation'; conversationId: string }
  | { kind: 'run'; runId: string }
  | { kind: 'worker'; runId: string; workerId: string }
  | { kind: 'operation'; operationId: string };

const VALID_KINDS = new Set<RefIdKind>([
  'note',
  'folder',
  'tag',
  'todo',
  'block',
  'conversation',
  'run',
  'worker',
  'operation',
]);

/**
 * Build a RefId string. Slash-separated note/folder paths remain readable;
 * unsafe URI characters are percent-encoded per path segment.
 */
export function buildRefId(input: RefIdInput): RefId {
  switch (input.kind) {
    case 'note':
      return `${REF_ID_SCHEME}note/${encodePath(input.notePath)}` as RefId;
    case 'folder':
      return `${REF_ID_SCHEME}folder/${encodePath(input.folderPath)}` as RefId;
    case 'tag':
      return `${REF_ID_SCHEME}tag/${encodeURIComponent(input.tag)}` as RefId;
    case 'todo':
      return `${REF_ID_SCHEME}todo/${encodePath(input.todoId)}` as RefId;
    case 'block':
      return `${REF_ID_SCHEME}block/${encodePath(input.notePath)}#${encodeURIComponent(input.blockId)}` as RefId;
    case 'conversation':
      return `${REF_ID_SCHEME}conversation/${encodeURIComponent(input.conversationId)}` as RefId;
    case 'run':
      return `${REF_ID_SCHEME}run/${encodeURIComponent(input.runId)}` as RefId;
    case 'worker':
      return `${REF_ID_SCHEME}worker/${encodeURIComponent(input.runId)}/${encodeURIComponent(input.workerId)}` as RefId;
    case 'operation':
      return `${REF_ID_SCHEME}operation/${encodeURIComponent(input.operationId)}` as RefId;
  }
}

export function isRefId(value: string): value is RefId {
  return parseRefId(value) !== null;
}

export function parseRefId(value: string): ParsedRefId | null {
  const raw = normalizeRawRefId(value);
  if (!raw.startsWith(REF_ID_SCHEME)) return null;

  const withoutScheme = raw.slice(REF_ID_SCHEME.length);
  const slashIndex = withoutScheme.indexOf('/');
  const kindValue = slashIndex === -1 ? withoutScheme : withoutScheme.slice(0, slashIndex);
  if (!VALID_KINDS.has(kindValue as RefIdKind)) return null;

  const kind = kindValue as RefIdKind;
  const restWithHash = slashIndex === -1 ? '' : withoutScheme.slice(slashIndex + 1);
  const hashIndex = restWithHash.indexOf('#');
  const rest = hashIndex === -1 ? restWithHash : restWithHash.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : restWithHash.slice(hashIndex + 1);
  const refId = raw as RefId;

  try {
    switch (kind) {
      case 'note': {
        const notePath = decodePath(rest);
        return notePath ? { raw: refId, kind, notePath } : null;
      }
      case 'folder':
        return { raw: refId, kind, folderPath: decodePath(rest) };
      case 'tag': {
        const tag = decodeURIComponent(rest);
        return tag ? { raw: refId, kind, tag } : null;
      }
      case 'todo': {
        const todoId = decodePath(rest);
        return todoId ? { raw: refId, kind, todoId } : null;
      }
      case 'block': {
        const notePath = decodePath(rest);
        const blockId = decodeURIComponent(hash);
        return notePath && blockId ? { raw: refId, kind, notePath, blockId } : null;
      }
      case 'conversation': {
        const conversationId = decodeURIComponent(rest);
        return conversationId ? { raw: refId, kind, conversationId } : null;
      }
      case 'run': {
        const runId = decodeURIComponent(rest);
        return runId ? { raw: refId, kind, runId } : null;
      }
      case 'worker': {
        const parts = rest.split('/');
        if (parts.length !== 2) return null;
        const runId = decodeURIComponent(parts[0] ?? '');
        const workerId = decodeURIComponent(parts[1] ?? '');
        return runId && workerId ? { raw: refId, kind, runId, workerId } : null;
      }
      case 'operation': {
        const operationId = decodeURIComponent(rest);
        return operationId ? { raw: refId, kind, operationId } : null;
      }
    }
  } catch {
    return null;
  }
}

/**
 * Extract unique RefIds from arbitrary user text in first-seen order.
 */
export function extractRefIds(text: string): RefId[] {
  const matches = text.match(/void:\/\/[^\s<>{}\[\]`"']+/g) ?? [];
  const seen = new Set<string>();
  const refs: RefId[] = [];

  for (const match of matches) {
    const normalized = normalizeRawRefId(match);
    if (seen.has(normalized) || !parseRefId(normalized)) continue;
    seen.add(normalized);
    refs.push(normalized as RefId);
  }

  return refs;
}

function normalizeRawRefId(value: string): string {
  return value.trim().replace(/[),.;:!?]+$/g, '');
}

function encodePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function decodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join('/');
}
