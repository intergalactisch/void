/**
 * Integration tests for Bootstrap (Composition Root)
 *
 * The "deep-resolve" suite at the bottom is the smoke test for the
 * whole DI graph: it walks every TOKENS entry and asserts that the
 * factory returns a non-null instance with the expected shape. Round-2
 * extractions (ConversationStore, ToolInvocationService,
 * CLIProcessEventRouter) added new factory closures with cross-
 * references; this guard catches any future wiring break before it
 * reaches a UI test.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { bootstrap, resetBootstrap, getAppContext, isBootstrapped, shutdown } from '$lib/bootstrap';
import { TOKENS } from '$lib/core';
import type { SettingsService, FileService, CredentialService } from '$lib/ports/inbound';
import type { CLIProviderPort } from '$lib/ports/outbound';

describe('Bootstrap', () => {
  beforeEach(() => {
    resetBootstrap();
  });

  afterEach(() => {
    resetBootstrap();
  });

  describe('bootstrap()', () => {
    it('initializes with mock adapters', async () => {
      const context = await bootstrap({ useMocks: true });

      expect(context).toBeDefined();
      expect(context.container).toBeDefined();
      expect(context.settings).toBeDefined();
      expect(context.files).toBeDefined();
      expect(context.credentials).toBeDefined();
    });

    it('registers all core services', async () => {
      const context = await bootstrap({ useMocks: true });
      const { container } = context;

      // Outbound ports
      expect(container.has(TOKENS.FileSystem)).toBe(true);
      expect(container.has(TOKENS.SettingsStorage)).toBe(true);
      expect(container.has(TOKENS.CredentialStorage)).toBe(true);

      // Inbound services
      expect(container.has(TOKENS.SettingsService)).toBe(true);
      expect(container.has(TOKENS.FileService)).toBe(true);
      expect(container.has(TOKENS.CredentialService)).toBe(true);
    });

    it('returns same context on subsequent calls', async () => {
      const context1 = await bootstrap({ useMocks: true });
      const context2 = await bootstrap({ useMocks: true });

      expect(context1).toBe(context2);
    });

    it('resolves services correctly', async () => {
      const context = await bootstrap({ useMocks: true });
      const { container } = context;

      const settings = container.resolve<SettingsService>(TOKENS.SettingsService);
      expect(settings).toBeDefined();
      expect(typeof settings.load).toBe('function');
      expect(typeof settings.set).toBe('function');

      const files = container.resolve<FileService>(TOKENS.FileService);
      expect(files).toBeDefined();

      const credentials = container.resolve<CredentialService>(TOKENS.CredentialService);
      expect(credentials).toBeDefined();
    });

    it('defaults operation CLI provider to Codex', async () => {
      const context = await bootstrap({ useMocks: true });
      const provider = context.container.resolve<CLIProviderPort>(TOKENS.CLIProvider);

      expect(provider.id).toBe('codex');
    });

    it('services can load and save data', async () => {
      const context = await bootstrap({ useMocks: true });

      // Test settings
      const loadResult = await context.settings.load();
      expect(loadResult.ok).toBe(true);

      // Test setting a value (set returns Promise<void>)
      await context.settings.set('theme', 'dark');

      // Verify it persisted
      const loadAgain = await context.settings.load();
      expect(loadAgain.ok).toBe(true);
      if (loadAgain.ok) {
        expect(loadAgain.value.theme).toBe('dark');
      }
    });

    it('accepts custom notes path', async () => {
      const customPath = '/custom/notes/path';
      const context = await bootstrap({
        useMocks: true,
        notesPath: customPath,
      });

      expect(context).toBeDefined();
    });
  });

  describe('isBootstrapped()', () => {
    it('returns false before bootstrap', () => {
      expect(isBootstrapped()).toBe(false);
    });

    it('returns true after bootstrap', async () => {
      await bootstrap({ useMocks: true });
      expect(isBootstrapped()).toBe(true);
    });

    it('returns false after reset', async () => {
      await bootstrap({ useMocks: true });
      resetBootstrap();
      expect(isBootstrapped()).toBe(false);
    });
  });

  describe('getAppContext()', () => {
    it('returns null before bootstrap', () => {
      expect(getAppContext()).toBeNull();
    });

    it('returns context after bootstrap', async () => {
      await bootstrap({ useMocks: true });
      const context = getAppContext();

      expect(context).not.toBeNull();
      expect(context?.container).toBeDefined();
    });

    it('returns null after reset', async () => {
      await bootstrap({ useMocks: true });
      resetBootstrap();
      expect(getAppContext()).toBeNull();
    });
  });

  describe('resetBootstrap()', () => {
    it('allows re-bootstrapping', async () => {
      const context1 = await bootstrap({ useMocks: true });
      resetBootstrap();
      const context2 = await bootstrap({ useMocks: true });

      expect(context1).not.toBe(context2);
    });

    it('creates fresh container', async () => {
      const context1 = await bootstrap({ useMocks: true });
      const container1 = context1.container;

      resetBootstrap();

      const context2 = await bootstrap({ useMocks: true });
      const container2 = context2.container;

      expect(container1).not.toBe(container2);
    });
  });

  describe('shutdown()', () => {
    it('disposes container singletons and clears the cached context', async () => {
      await bootstrap({ useMocks: true });
      expect(isBootstrapped()).toBe(true);

      await shutdown();

      expect(isBootstrapped()).toBe(false);
      expect(getAppContext()).toBeNull();
    });

    it('lets a subsequent bootstrap rebuild the graph', async () => {
      await bootstrap({ useMocks: true });
      await shutdown();
      const ctx = await bootstrap({ useMocks: true });
      expect(ctx.container).toBeDefined();
    });

    it('is a no-op when never bootstrapped', async () => {
      await expect(shutdown()).resolves.not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Deep-resolve guard: every TOKEN must produce a usable instance.
  // This is the structural smoke test for the whole DI graph.
  // ─────────────────────────────────────────────────────────────────
  describe('deep resolve (every TOKEN must resolve)', () => {
    it('every registered token produces a non-null value', async () => {
      const { container } = await bootstrap({ useMocks: true });
      const failures: string[] = [];

      for (const [name, token] of Object.entries(TOKENS)) {
        if (!container.has(token)) {
          failures.push(`${name}: not registered`);
          continue;
        }
        try {
          const instance = container.resolve(token);
          if (instance === undefined || instance === null) {
            failures.push(`${name}: resolved to ${String(instance)}`);
          }
        } catch (e) {
          failures.push(`${name}: threw ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      expect(failures).toEqual([]);
    });

    it('AppContext exposes every service the layout reads', async () => {
      const ctx = await bootstrap({ useMocks: true });
      // These are the surfaces consumed by stores and the +layout.svelte
      // boot path. Adding a service to AppContext is a deliberate API
      // change — the test fails on regression and on accidental field
      // removal.
      expect(typeof ctx.settings.load).toBe('function');
      expect(typeof ctx.files.read).toBe('function');
      expect(typeof ctx.credentials.get).toBe('function');
      expect(typeof ctx.editor.openDocument).toBe('function');
      expect(typeof ctx.commands.search).toBe('function');
      expect(typeof ctx.aiRewrite.rewriteSelection).toBe('function');
      expect(typeof ctx.toolRegistry.register).toBe('function');
      expect(typeof ctx.aiAssistant.prompt).toBe('function');
      expect(typeof ctx.todoService.create).toBe('function');
      expect(typeof ctx.notesService.loadDocument).toBe('function');
      expect(typeof ctx.operationService.queue).toBe('function');
      expect(typeof ctx.agentOrchestration.startRun).toBe('function');
      expect(typeof ctx.agentIntake.decide).toBe('function');
    });

    it('round-2 peers wire through their host services', async () => {
      // ToolInvocationService is exercised through AIAssistant
      const ctx = await bootstrap({ useMocks: true });
      // executeToolCalls now delegates to the extracted service; if the
      // factory closure forgets to construct it, this throws.
      const result = await ctx.aiAssistant.executeToolCalls([], 'cid');
      expect(Array.isArray(result)).toBe(true);
    });

    it('memory adapters honour the FileSystemPort.exists() contract', async () => {
      // Round-1 changed exists() to return Result<boolean, Error>.
      // Re-asserting the shape catches any future regression that
      // silently swaps it back to Promise<boolean>.
      const ctx = await bootstrap({ useMocks: true });
      const r = await ctx.files.exists('/');
      expect(r).toHaveProperty('ok');
      if (r.ok) {
        expect(typeof r.value).toBe('boolean');
      }
    });
  });
});
