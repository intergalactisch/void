/**
 * ExternalNavigationPort - opens URLs and files outside the editor/app surface.
 */

import type { Result } from '$lib/core';

export interface ExternalNavigationPort {
  openUrl(url: string): Promise<Result<void, Error>>;
  revealPath(path: string): Promise<Result<void, Error>>;
}
