/**
 * CaptureService — inbound port for the global quick-capture flow.
 *
 * Routes a brief snippet to either the Inbox folder (creates a new note) or
 * today's daily note (appends a timestamped section). Tags are written as
 * frontmatter for inbox captures and as hashtag suffixes for daily appends.
 */

import type { Result } from '$lib/core';
import type { CaptureTarget } from '$lib/domain';

export interface CaptureRequest {
  /** Body of the capture. Trimmed; empty content is rejected. */
  text: string;
  /** Where to save. */
  target: CaptureTarget;
  /** Optional tags. May be empty. Caller is responsible for normalization. */
  tags: string[];
}

export interface CaptureResult {
  /** Path of the note that was written (relative to notes root). */
  path: string;
  /** Echoes the target that was actually used. */
  target: CaptureTarget;
  /**
   * `true` if the inbox path created a new file or the daily path created
   * today's daily note from scratch. `false` if an existing daily note was
   * appended to.
   */
  created: boolean;
}

export interface CaptureService {
  /**
   * Save a quick-captured snippet.
   * - `target: 'inbox'` → creates a new note in `Inbox/` with an auto-generated
   *   title derived from the first line of `text` (or a timestamp fallback).
   * - `target: 'daily'` → appends a timestamped section to `daily/YYYY-MM-DD.md`,
   *   creating the file if missing.
   */
  quickCapture(request: CaptureRequest): Promise<Result<CaptureResult, Error>>;
}
