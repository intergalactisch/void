import type { Result } from '$lib/core';

export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

export interface LocalNotification {
  id: string;
  title: string;
  body?: string;
  action?: 'open-sync-center' | 'open-ai-jobs' | 'open-conflict-review';
}

export interface NotificationPort {
  permission(): Promise<Result<NotificationPermissionState, Error>>;
  requestPermission(): Promise<Result<NotificationPermissionState, Error>>;
  show(notification: LocalNotification): Promise<Result<void, Error>>;
}
