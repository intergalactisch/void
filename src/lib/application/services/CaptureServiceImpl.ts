/**
 * CaptureServiceImpl — orchestrates the global quick-capture flow.
 *
 * Routes a small text snippet to one of two destinations:
 *   - `inbox`: creates a new note in `Inbox/` (auto-generated title from the
 *     first line of the text; tags become frontmatter).
 *   - `daily`: appends a timestamped section to `daily/YYYY-MM-DD.md`,
 *     creating the file if missing; tags become a hashtag suffix.
 *
 * Reuses `DocumentService.createWithContent` / `readContent` / `writeContent`
 * so existing behaviours (unique-path generation, todo sync, notes refresh)
 * apply for free.
 */

import { ok, err, type Result } from '$lib/core';
import type {
  CaptureRequest,
  CaptureResult,
  CaptureService,
} from '$lib/ports/inbound/CaptureService';
import type { DocumentService } from '$lib/ports/inbound/DocumentService';
import { dailyNotePath, deriveTextNoteTitle, formatDailyDate, formatDailyTime } from '$lib/domain';
import { getLogger } from '$lib/logging';

const log = getLogger('CaptureService');

const INBOX_FOLDER = 'Inbox';

export class CaptureServiceImpl implements CaptureService {
  constructor(
    private readonly documentService: DocumentService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async quickCapture(request: CaptureRequest): Promise<Result<CaptureResult, Error>> {
    const text = request.text.trim();
    if (!text) {
      return err(new Error('Cannot capture empty content'));
    }

    const tags = normalizeTags(request.tags);

    if (request.target === 'daily') {
      return this.captureDaily(text, tags);
    }
    return this.captureInbox(text, tags);
  }

  private async captureInbox(
    text: string,
    tags: string[],
  ): Promise<Result<CaptureResult, Error>> {
    const now = this.now();
    const title = deriveTextNoteTitle(text, { now, fallbackPrefix: 'Capture' });
    const markdown = buildInboxMarkdown(text, tags);

    const result = await this.documentService.createWithContent(
      INBOX_FOLDER,
      title,
      markdown,
      // Don't auto-focus — capture window must close cleanly without
      // racing the main editor for focus.
      { type: 'user', autoFocus: false },
    );

    if (!result.ok) {
      log.error('captureInbox failed', { error: result.error.message });
      return err(result.error);
    }

    log.info('captureInbox saved', { path: result.value.path });
    return ok({ path: result.value.path, target: 'inbox', created: true });
  }

  private async captureDaily(
    text: string,
    tags: string[],
  ): Promise<Result<CaptureResult, Error>> {
    const now = this.now();
    const dateStr = formatDailyDate(now);
    const timeStr = formatDailyTime(now);
    const path = dailyNotePath(now);

    const existing = await this.documentService.readContent(path);
    let baseContent: string;
    let created = false;

    if (existing.ok) {
      baseContent = ensureTrailingBlankLine(existing.value);
    } else {
      // No daily note yet — create it with a header.
      const createResult = await this.documentService.createWithContent(
        'daily',
        dateStr,
        `# ${dateStr}\n\n`,
        { type: 'user', autoFocus: false },
      );
      if (!createResult.ok) {
        log.error('captureDaily: failed to create daily note', {
          path,
          error: createResult.error.message,
        });
        return err(createResult.error);
      }
      created = true;

      const reread = await this.documentService.readContent(createResult.value.path);
      if (!reread.ok) {
        log.error('captureDaily: failed to read newly created daily note', {
          path: createResult.value.path,
          error: reread.error.message,
        });
        return err(reread.error);
      }
      baseContent = ensureTrailingBlankLine(reread.value);
    }

    const appendBlock = buildDailyAppendBlock(text, tags, timeStr);
    const merged = baseContent + appendBlock;

    const writeResult = await this.documentService.writeContent(path, merged);
    if (!writeResult.ok) {
      log.error('captureDaily: write failed', { path, error: writeResult.error.message });
      return err(writeResult.error);
    }

    log.info('captureDaily appended', { path, created });
    return ok({ path, target: 'daily', created });
  }
}

function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().replace(/^#+/, '');
    if (!trimmed) continue;
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(trimmed);
  }
  return out;
}

function buildInboxMarkdown(text: string, tags: string[]): string {
  const parts: string[] = [];
  if (tags.length > 0) {
    parts.push('---');
    parts.push(`tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]`);
    parts.push('---');
    parts.push('');
  }
  parts.push(text);
  parts.push('');
  return parts.join('\n');
}

function buildDailyAppendBlock(text: string, tags: string[], timeStr: string): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`## ${timeStr}`);
  lines.push('');
  lines.push(text);
  if (tags.length > 0) {
    lines.push('');
    lines.push(tags.map((t) => `#${t}`).join(' '));
  }
  lines.push('');
  return lines.join('\n');
}

function ensureTrailingBlankLine(content: string): string {
  if (content.length === 0) return '';
  if (content.endsWith('\n')) return content;
  return content + '\n';
}
