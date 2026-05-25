import { ok, type Result } from '$lib/core';
import type {
  LocalNotification,
  NotificationPermissionState,
  NotificationPort,
} from '$lib/ports/outbound';

export class MemoryNotificationAdapter implements NotificationPort {
  private state: NotificationPermissionState = 'granted';
  readonly sent: LocalNotification[] = [];

  async permission(): Promise<Result<NotificationPermissionState, Error>> {
    return ok(this.state);
  }

  async requestPermission(): Promise<Result<NotificationPermissionState, Error>> {
    return ok(this.state);
  }

  async show(notification: LocalNotification): Promise<Result<void, Error>> {
    this.sent.push(notification);
    return ok(undefined);
  }

  setPermission(state: NotificationPermissionState): void {
    this.state = state;
  }
}
