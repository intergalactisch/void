/**
 * EventApplicationNavigationAdapter - typed app navigation bridge.
 *
 * Direct note/folder selection goes through NotesService. Shell-only views
 * are emitted as app navigation events consumed by the route component.
 */

import { ok, type Result } from '$lib/core';
import { events } from '$lib/events';
import type { NotesService } from '$lib/ports/inbound/NotesService';
import type { ApplicationNavigationPort } from '$lib/ports/outbound/ApplicationNavigationPort';

export class EventApplicationNavigationAdapter implements ApplicationNavigationPort {
  constructor(private readonly notes: NotesService) {}

  async goHome(): Promise<Result<void, Error>> {
    this.notes.selectNote(null);
    events.emit('app:navigate', { view: 'home' });
    return ok(undefined);
  }

  async openNote(path: string): Promise<Result<void, Error>> {
    this.notes.selectNote(path);
    events.emit('app:navigate', { view: 'note', path });
    return ok(undefined);
  }

  async openFolder(path: string): Promise<Result<void, Error>> {
    if (path) this.notes.expandFolder(path);
    this.notes.selectNote(null);
    events.emit('app:navigate', { view: 'folder', path });
    return ok(undefined);
  }

  async openSearch(query?: string): Promise<Result<void, Error>> {
    events.emit('app:navigate', query ? { view: 'search', query } : { view: 'search' });
    return ok(undefined);
  }

  async openTasks(): Promise<Result<void, Error>> {
    events.emit('app:navigate', { view: 'tasks' });
    return ok(undefined);
  }

  async openActions(): Promise<Result<void, Error>> {
    events.emit('app:navigate', { view: 'actions' });
    return ok(undefined);
  }

  async openSettings(): Promise<Result<void, Error>> {
    events.emit('app:navigate', { view: 'settings' });
    return ok(undefined);
  }

  async back(): Promise<Result<void, Error>> {
    events.emit('app:navigate', { view: 'back' });
    return ok(undefined);
  }

  async forward(): Promise<Result<void, Error>> {
    events.emit('app:navigate', { view: 'forward' });
    return ok(undefined);
  }
}
