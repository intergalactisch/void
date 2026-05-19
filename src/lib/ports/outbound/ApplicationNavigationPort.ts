/**
 * ApplicationNavigationPort - typed app navigation for AI tools.
 */

import type { Result } from '$lib/core';

export type ApplicationView = 'home' | 'search' | 'tasks' | 'actions' | 'settings';

export interface ApplicationNavigationPort {
  goHome(): Promise<Result<void, Error>>;
  openNote(path: string): Promise<Result<void, Error>>;
  openFolder(path: string): Promise<Result<void, Error>>;
  openSearch(query?: string): Promise<Result<void, Error>>;
  openTasks(): Promise<Result<void, Error>>;
  openActions(): Promise<Result<void, Error>>;
  openSettings(): Promise<Result<void, Error>>;
  back(): Promise<Result<void, Error>>;
  forward(): Promise<Result<void, Error>>;
}
