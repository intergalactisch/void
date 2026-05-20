/**
 * Event Map - Typed events for the application
 *
 * All events are strongly typed. The key is the event name (namespace:action format)
 * and the value is the payload type.
 */

import type { Document } from '$lib/domain/entities/Document';
import type { Selection } from '$lib/domain/values/Selection';
import type { ToolId } from '$lib/domain/values/ToolId';
import type { ToolResult } from '$lib/domain/values/ToolResult';
import type { AIResponse } from '$lib/domain/values/AIResponse';
import type { Todo } from '$lib/domain/entities/Todo';
import type { OperationId } from '$lib/domain/values/OperationId';
import type { ProvenanceEvent } from '$lib/domain/values/ProvenanceEvent';
import type { BlockType } from '$lib/domain/values/BlockType';
import type { AgentRunEvent } from '$lib/domain/entities/AgentRun';
import type { Settings } from '$lib/domain/entities/Settings';
import type { ResourceLockSnapshot } from './queue/ResourceLock';
import type {
  SyncAuthState,
  SyncConflict,
  SyncOperation,
  SyncStatus,
} from '$lib/domain/values/Sync';

export type { Settings };

export type EventMap = {
  // Application lifecycle
  'app:ready': void;
  'app:navigate':
    | { view: 'home' }
    | { view: 'note'; path: string }
    | { view: 'folder'; path: string }
    | { view: 'tag'; tag: string | null }
    | { view: 'search'; query?: string }
    | { view: 'tasks' }
    | { view: 'actions' }
    | { view: 'settings' }
    | { view: 'back' }
    | { view: 'forward' };

  // Settings events
  'settings:changed': { key: string; value: unknown };
  'workspace:changed': { workspaceId: string; activeWorkspaceId: string };
  'settings:loaded': Settings;

  // Editor events
  'editor:change': { document: Document };
  'editor:selection': { selection: Selection };
  'editor:focus': void;
  'editor:blur': void;
  'editor:ready': void;
  'editor:slash-menu-change': { state: unknown };
  'editor:page-link-menu-change': { state: unknown };
  'editor:block-menu-request': {
    blockId: string;
    lineIndex: number;
    position: { top: number; left: number };
    currentType: BlockType;
    mode: 'actions' | 'convert';
  };
  'editor:lineage-inspect-request': {
    blockId: string;
    lineIndex: number;
    position: { top: number; left: number };
    currentType: BlockType;
  };
  'editor:page-link-clicked': { path: string };
  'editor:external-link-clicked': { url: string };
  'editor:todo-toggled': { blockId: string; content: string; checked: boolean };

  // Editor block-level events
  'editor:block-selected': { blockIds: string[] };
  'editor:block-moved': { blockId: string; fromIndex: number; toIndex: number };
  'editor:block-converted': { blockId: string; fromType: string; toType: string };
  'editor:block-ai-locked': { blockId: string; operation: string };
  'editor:block-ai-unlocked': { blockId: string };
  'editor:block-ai-phase': { blockId: string; operation: string; phase: string };
  'editor:block-ai-active-target': { blockId: string | null };
  'editor:block-scrolled-into-view': { blockId: string; mode: 'nearest' | 'center' | 'smart' };

  // Document events
  'document:opened': { document: Document };
  'document:saved': { path: string };
  'document:closed': { path: string };
  'document:save-failed': { path: string | null; error: Error };
  'document:load-failed': { path: string; error: Error };

  // Generic user-facing error. Stores emit this when an operation fails in
  // a way the user should see (load, save, create, delete). The toast
  // bridge in bootstrap subscribes once.
  'error:user-facing': { source: string; error: Error };

  // GitHub cloud sync events
  'sync:started': { operation: SyncOperation };
  'sync:status-changed': { status: SyncStatus };
  'sync:completed': { status: SyncStatus };
  'sync:failed': { error: Error };
  'sync:conflict': { conflicts: SyncConflict[] };
  'sync:auth-changed': { auth: SyncAuthState };

  // Filesystem watcher events. The Rust file watcher emits void://file-changed
  // events; the TS bridge translates them into these typed events so any
  // service can subscribe (editor for auto-reload, todos for cache, etc.).
  'file:changed': { path: string; kind: 'create' | 'modify' | 'remove' | 'rename' | 'other' };

  // Self-write notification. Any service that mutates a file the editor may
  // have open MUST emit this synchronously BEFORE its disk write, with the
  // same absolute path the watcher will emit. EditorService stamps
  // session.lastSavedAt so the upcoming file:changed event is treated as a
  // self-write and skipped, preventing spurious external-modified conflicts.
  'editor:self-write': { path: string };

  // Editor session conflict — the on-disk file was modified or removed
  // while a session held unsaved edits. Phase 6 surfaces a banner; for
  // now this is just a signal that something needs UI attention.
  'editor:conflict': { path: string; kind: 'modified' | 'deleted' };

  // AI events
  'ai:processing': { blockId: string; operation: string };
  'ai:complete': { blockId: string; result: string };
  'ai:error': { blockId: string; error: Error };

  // AI shortcut requests (emitted by keyboard shortcuts, consumed by AI sidebar/service)
  'ai:rewrite-request': { blockId: string; blockType: string; content: string };
  'ai:expand-request': { blockId: string; blockType: string; content: string };

  // Tool execution events
  'tool:executing': { invocationId: string; toolId: ToolId };
  'tool:progress': { invocationId: string; progress: number; message?: string };
  'tool:completed': { invocationId: string; result: ToolResult };
  'tool:failed': { invocationId: string; error: Error };
  'tool:cancelled': { invocationId: string };
  'tool:pending_confirmation': { invocationId: string; toolId: ToolId };
  'tool:rejected': { invocationId: string; reason: string };
  'tool:executed': { invocationId: string; result: ToolResult };

  // AI Assistant events
  'ai:response': { conversationId: string; response: AIResponse };
  'agent:event': { runId: string; event: AgentRunEvent };

  // Note tool events (handled by application layer)
  'tool:note:create': {
    title?: string;
    content?: string;
    tags?: string[];
    folder?: string;
  };
  'tool:note:read': { noteId: string };
  'tool:note:update': {
    noteId: string;
    title?: string;
    content?: string;
    tags?: string[];
  };
  'tool:note:delete': { noteId: string };
  'tool:note:list': { folder?: string; tags?: string[] };

  // Editor tool events
  'tool:editor:insert': { text: string; position?: number };
  'tool:editor:format': {
    format: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code';
  };
  'tool:editor:replace': { text: string };

  // Search tool events
  'tool:search:notes': { query: string; limit?: number };
  'tool:search:content': { query: string; noteId?: string };

  // Navigation tool events
  'tool:navigation:goto': { target: string; type?: 'note' | 'view' };
  'tool:navigation:back': void;
  'tool:navigation:forward': void;

  // TODO events
  'todo:sync-to-editor': { filePath: string; content: string; checked: boolean };
  'todo:update-in-editor': {
    filePath: string;
    id: string;
    content: string;
    previousContent?: string;
    checked: boolean;
  };
  'todo:delete-from-editor': { filePath: string; id: string; content?: string };
  'todo:initialized': void;
  'todo:toggled': { todo: Todo };
  'todo:created': { todo: Todo };
  'todo:updated': { todo: Todo };
  'todo:deleted': { id: string };
  'todo:file-changed': { path: string };
  'todo:file-created': { path: string };
  'todo:file-deleted': { path: string };

  // Operation system events
  'operation:queued': { operationId: OperationId };
  'operation:started': { operationId: OperationId };
  'operation:progress': { operationId: OperationId; percent: number; message: string };
  'operation:completed': { operationId: OperationId };
  'operation:failed': { operationId: OperationId; error: string };
  'operation:cancelled': { operationId: OperationId };
  'operation:result-applied': { operationId: OperationId };

  // Command lifecycle events (for event-driven architecture)
  'command:started': { commandId: string; commandType: string; resourceId?: string | undefined };
  'command:completed': { commandId: string; commandType: string; resourceId?: string | undefined };
  'command:failed': { commandId: string; commandType: string; error: string; resourceId?: string | undefined };

  // Resource coordination events
  'resource-lock:changed': {
    resourceId: string | null;
    reason: 'acquired' | 'queued' | 'released' | 'cleared';
    resources: ResourceLockSnapshot[];
  };

  // Domain note events (emitted by CommandBus handlers)
  'note:created': { path: string; document: import('$lib/domain/entities/Document').Document; source: 'user' | 'ai' | 'system' };
  'note:saved': { path: string; savedAt: Date; source: 'user' | 'ai' | 'system' };
  'note:deleted': { path: string; source: 'user' | 'ai' | 'system' };
  'note:renamed': { oldPath: string; newPath: string; newTitle: string; source: 'user' | 'ai' | 'system' };
  'note:opened': { path: string; document: import('$lib/domain/entities/Document').Document };
  'note:closed': { path: string };

  // Provenance events (Artifact system)
  'provenance:recorded': { noteName: string; event: ProvenanceEvent };

  // Session membership events (Artifact system)
  'session:changed': {
    sessionId: string;
    notePath?: string;
    action: 'created' | 'updated' | 'member-added' | 'member-removed' | 'deleted';
  };

  // Action events (Artifact system)
  'action:started': { actionId: string; notePath: string };
  'action:completed': { actionId: string; notePath: string };

  // Pulse events (Artifact system)
  'pulse:new-insight': { count: number };
  'pulse:dismissed': { insightId: string };

  // Power-user shell requests (emitted by registered commands, consumed by
  // the route component that owns the relevant DOM/dialog).
  'app:request-export-markdown': Record<string, never>;
  'tasks:request-new': Record<string, never>;

  // Power-user command execution (emitted by CommandServiceImpl after a
  // successful executeById). Frecency tracking and analytics subscribe.
  'command:executed': { commandId: string };
};
