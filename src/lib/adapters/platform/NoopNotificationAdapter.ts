import { ok, type Result } from '$lib/core';
import type {
  LocalNotification,
  NotificationPermissionState,
  NotificationPort,
} from '$lib/ports/outbound';

export class NoopNotificationAdapter implements NotificationPort {
  async permission(): Promise<Result<NotificationPermissionState, Error>> {
    return ok('unsupported');
  }

  async requestPermission(): Promise<Result<NotificationPermissionState, Error>> {
    return ok('unsupported');
  }

  async show(_notification: LocalNotification): Promise<Result<void, Error>> {
    return ok(undefined);
  }
}
