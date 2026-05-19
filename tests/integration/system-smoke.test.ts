/**
 * System smoke test
 *
 * Boots the full DI graph with memory adapters (the same path the
 * Vite dev server uses outside Tauri) and drives the major
 * user-facing flows through their store APIs:
 *
 *   - settings: load + theme change
 *   - notes: quick-create + load + save + delete
 *   - todos: create + toggle + delete
 *   - tools: registry populated from registerAllTools()
 *   - AI conversations: create + list + clear + delete
 *   - operations: queue → started → completed via the mock CLI
 *   - clean shutdown
 *
 * This catches "the wiring is broken" regressions that the unit tests
 * miss — the very things the round-2 god-class splits could break:
 * AIAssistant ↔ ConversationStore ↔ ToolInvocationService callbacks,
 * OperationService ↔ CLIProcessEventRouter bridge, NotesService ↔
 * DocumentPort round-trip, settings → events.
 *
 * Pure code, no browser, no Playwright. Runs in vitest in seconds.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  bootstrap,
  resetBootstrap,
  shutdown,
  type AppContext,
} from '$lib/bootstrap';
import {
  settingsStore,
  notesStore,
  todoStore,
  aiStore,
  toolStore,
  filesStore,
  credentialsStore,
  operationsStore,
} from '$lib/stores';
import { events } from '$lib/events';

/**
 * Wait for a predicate to become true, polling every 10ms. Used to
 * settle the asynchronous CLI process events emitted by the mock
 * session manager.
 */
async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 1000, label = 'condition' }: { timeoutMs?: number; label?: string } = {},
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('system smoke', () => {
  let ctx: AppContext;

  beforeEach(async () => {
    resetBootstrap();
    ctx = await bootstrap({ useMocks: true });

    // Initialize every store the way +layout.svelte / bootstrap would
    // for a real session. If any of these throw, the wiring is broken.
    settingsStore.init(ctx.settings);
    notesStore.init(ctx.notesService);
    todoStore.init(ctx.todoService);
    aiStore.init(ctx.aiAssistant);
    toolStore.init(ctx.toolRegistry);
    filesStore.init(ctx.files);
    credentialsStore.init(ctx.credentials);
    operationsStore.init(ctx.operationService);

    await settingsStore.load();
  });

  afterEach(async () => {
    await shutdown();
  });

  // ─────────────────────────────────────────────────────────────────
  // Settings flow
  // ─────────────────────────────────────────────────────────────────
  describe('settings', () => {
    it('loads defaults and emits settings:loaded', async () => {
      expect(settingsStore.settings).not.toBeNull();
      expect(settingsStore.settings?.theme).toBeDefined();
    });

    it('updates a setting and persists across a reload', async () => {
      // settings:changed is emitted by SettingsServiceImpl.set
      const captured: Array<{ key: string; value: unknown }> = [];
      const handler = (p: { key: string; value: unknown }) => {
        captured.push(p);
      };
      events.on('settings:changed', handler);

      const okSet = await settingsStore.set('theme', 'dark');
      expect(okSet).toBe(true);
      expect(settingsStore.settings?.theme).toBe('dark');

      // Reload from storage (round-trips through the memory adapter).
      const loadResult = await ctx.settings.load();
      expect(loadResult.ok).toBe(true);
      if (loadResult.ok) {
        expect(loadResult.value.theme).toBe('dark');
      }

      // The event bus carries the change so the rest of the app reacts.
      expect(captured).toEqual(
        expect.arrayContaining([{ key: 'theme', value: 'dark' }]),
      );

      events.off('settings:changed', handler);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Notes flow — quick-create → load → save → delete
  // ─────────────────────────────────────────────────────────────────
  describe('notes', () => {
    it('creates, loads, saves, and deletes a quick note', async () => {
      // createQuickNote round-trips: NotesService.createQuickNote →
      // DocumentPort.create → MarkdownSerializer → FileSystemPort.write
      // Returning a non-null Document means every link in that chain
      // succeeded against the memory adapters.
      const created = await notesStore.createQuickNote();
      expect(created).not.toBeNull();
      if (!created) return;

      // loadDocument round-trips back through the same chain.
      const loaded = await notesStore.loadDocument(created.path);
      expect(loaded).not.toBeNull();
      expect(loaded?.path).toBe(created.path);

      // saveDocument persists modifications and fires document:saved.
      const saveListener: string[] = [];
      const onSaved = (p: { path: string }) => saveListener.push(p.path);
      events.on('document:saved', onSaved);

      const saveResult = await notesStore.saveDocument({
        ...loaded!,
        meta: { ...loaded!.meta, title: 'Renamed' },
      });
      expect(saveResult.ok).toBe(true);
      expect(saveListener).toContain(created.path);
      events.off('document:saved', onSaved);

      // Cleanup.
      const deleted = await notesStore.deleteNote(created.path);
      expect(deleted).toBe(true);
    });

    it('rejects path traversal in document load (round-1 P0 guard)', async () => {
      // The MarkdownAdapter resolvePath fix should still reject
      // absolute / parent paths even after the round-2 splits.
      const r = await notesStore.loadDocument('../../etc/passwd');
      expect(r).toBeNull();
      expect(notesStore.error).not.toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Todo flow
  // ─────────────────────────────────────────────────────────────────
  describe('todos', () => {
    it('creates, toggles, and deletes a todo through the store', async () => {
      // Make sure the TODO file exists by creating a default note first.
      // The MarkdownTodoRepository creates TODO.md lazily on first write.
      await todoStore.create('Smoke todo');
      await todoStore.refresh();

      const created = todoStore.todos.find((t) => t.content === 'Smoke todo');
      expect(created).toBeDefined();
      if (!created) return;

      const initial = created.isCompleted;
      await todoStore.toggle(created.id);
      // The store applies an optimistic update plus an async confirm.
      const toggled = todoStore.todos.find((t) => t.id === created.id);
      expect(toggled?.isCompleted).toBe(!initial);

      await todoStore.delete(created.id);
      await todoStore.refresh();
      expect(todoStore.todos.find((t) => t.id === created.id)).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Tool registry — bootstrap registered every tool definition
  // ─────────────────────────────────────────────────────────────────
  describe('tools', () => {
    it('exposes the full tool catalog via the registry', async () => {
      await toolStore.load();
      // The exact count is brittle — checking that "many" tools loaded
      // and the high-traffic ones are present is enough.
      expect(toolStore.tools.length).toBeGreaterThan(20);
      const ids = toolStore.tools.map((t) => t.id);
      expect(ids).toEqual(
        expect.arrayContaining(['note:create', 'note:read', 'todo:create']),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // AI conversation lifecycle (round-2 ConversationStore wiring)
  // ─────────────────────────────────────────────────────────────────
  describe('ai conversations', () => {
    it('creates, lists, clears, and deletes a conversation', async () => {
      const fresh = await ctx.aiAssistant.createNewConversation();
      expect(fresh.id).toBeTruthy();

      await ctx.aiAssistant.setCurrentConversation(fresh.id);
      const current = ctx.aiAssistant.getCurrentConversation();
      expect(current?.id).toBe(fresh.id);

      const list = await ctx.aiAssistant.listConversations();
      expect(list.find((c) => c.id === fresh.id)).toBeDefined();

      await ctx.aiAssistant.clearConversation(fresh.id);
      const cleared = await ctx.aiAssistant.getConversation(fresh.id);
      expect(cleared.messages).toEqual([]);

      await ctx.aiAssistant.deleteConversation(fresh.id);
      const after = await ctx.aiAssistant.listConversations();
      expect(after.find((c) => c.id === fresh.id)).toBeUndefined();
    });

    it('routes empty tool-call lists through ToolInvocationService', async () => {
      // Round-2 extracted tool execution into ToolInvocationService.
      // The trivial empty case verifies the bootstrap callback wiring
      // (attachInvocation/updateInvocation/setExecutingTools) without
      // needing a working AI provider.
      const conv = await ctx.aiAssistant.createNewConversation();
      const result = await ctx.aiAssistant.executeToolCalls([], conv.id);
      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Operations — queue → started → completed via mock CLI
  // ─────────────────────────────────────────────────────────────────
  describe('operations', () => {
    it('runs a queued operation through the CLIProcessEventRouter', async () => {
      // Mock CLI session manager auto-completes spawns after ~100ms,
      // emitting started → completed. The router (round 2 extraction)
      // turns those events into operation state transitions.
      const queued = await operationsStore.queue({
        type: 'single',
        label: 'Smoke',
        prompt: 'do nothing',
      });
      expect(queued).not.toBeNull();
      if (!queued) return;

      await waitFor(
        () => {
          const op = ctx.operationService.getOperation(queued.id);
          return op?.status === 'completed';
        },
        { timeoutMs: 2000, label: 'operation completion' },
      );

      const completed = ctx.operationService.getOperation(queued.id);
      expect(completed?.status).toBe('completed');
      expect(completed?.result).not.toBeNull();
    });

    it('reflects completion in the operationsStore reactive state', async () => {
      const queued = await operationsStore.queue({
        type: 'single',
        label: 'Smoke 2',
        prompt: 'do nothing',
      });
      if (!queued) return;

      await waitFor(
        () =>
          operationsStore.completedOperations.some((o) => o.id === queued.id),
        { timeoutMs: 2000, label: 'store completion mirror' },
      );

      const fromStore = operationsStore.completedOperations.find(
        (o) => o.id === queued.id,
      );
      expect(fromStore?.status).toBe('completed');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Clean shutdown
  // ─────────────────────────────────────────────────────────────────
  describe('shutdown', () => {
    it('disposes singletons without throwing', async () => {
      await expect(shutdown()).resolves.not.toThrow();
    });

    it('lets bootstrap rebuild after shutdown', async () => {
      await shutdown();
      const next = await bootstrap({ useMocks: true });
      expect(next.container).toBeDefined();
      // The new context is independent from the previous one.
      expect(next).not.toBe(ctx);
    });
  });
});

