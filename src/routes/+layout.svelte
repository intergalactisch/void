<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import '../app.css';
  import { bootstrap, getAppContext, isBootstrapped } from '$lib';
  import { operationsStore, platformStore, settingsStore, uiStore } from '$lib/stores';
  import { AppTitlebar, MobileTabBar, ShortcutSheet } from '$lib/components/shared';

  let { children } = $props();

  // The /capture route is loaded into a separate Tauri webview window. It must
  // NOT spin up the full app shell (AppTitlebar, bootstrap, file watchers, AI
  // services). SvelteKit's `+layout@.svelte` reset escapes intermediate layouts
  // but not the root, so we explicitly short-circuit here.
  const isCaptureRoute =
    typeof window !== 'undefined' &&
    window.location.pathname.replace(/\/$/, '') === '/capture';

  /**
   * Application ready state.
   * True once bootstrap completes successfully.
   */
  let ready = $state(false);

  /**
   * Bootstrap error if initialization fails.
   */
  let error = $state<Error | null>(null);
  let cleanupCloseListener: (() => void) | null = null;

  /**
   * Resolve the effective theme ('light' or 'dark') from the setting.
   * 'system' defers to the OS preference.
   */
  function resolveTheme(mode: 'light' | 'dark' | 'system'): 'light' | 'dark' {
    if (mode === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return mode;
  }

  function applyTheme(mode: 'light' | 'dark' | 'system') {
    document.documentElement.setAttribute('data-theme', resolveTheme(mode));
  }

  // Reactively apply theme when settings change
  $effect(() => {
    const theme = settingsStore.settings?.theme;
    if (theme) {
      applyTheme(theme);
    }
  });

  // Reactively apply density mode (data-density) on root element.
  $effect(() => {
    const density = settingsStore.settings?.density;
    if (density) {
      document.documentElement.setAttribute('data-density', density);
    }
  });

  // OS theme change listener (for 'system' mode)
  let mediaQuery: MediaQueryList | null = null;
  const handleMediaChange = () => {
    const theme = settingsStore.settings?.theme;
    if (theme === 'system') {
      applyTheme('system');
    }
  };

  function handleGlobalKeydown(event: KeyboardEvent) {
    const isMod = event.metaKey || event.ctrlKey;
    if (isMod && event.key === '/') {
      event.preventDefault();
      uiStore.toggleShortcutSheet();
      return;
    }
  }

  onMount(async () => {
    // The capture window is a thin UI surface — bypass the entire app shell
    // (no bootstrap, no AppTitlebar, no theme listeners) and let the
    // /capture page render directly.
    if (isCaptureRoute) {
      ready = true;
      return;
    }

    // Default to light until settings load
    document.documentElement.setAttribute('data-theme', 'light');

    // Listen for OS theme changes when using 'system' mode
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', handleMediaChange);
    window.addEventListener('keydown', handleGlobalKeydown);

    const isTauri =
      typeof window !== 'undefined' &&
      ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

    // Persist running operations on window close and keep the tray app alive.
    if (isTauri) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const currentWindow = getCurrentWindow();
        cleanupCloseListener = await currentWindow.onCloseRequested(async (event) => {
          event.preventDefault();
          if (operationsStore.hasActiveOperations) {
            await operationsStore.persistRunningOperations();
          }
          await getAppContext()?.lineage.flush();
          await currentWindow.hide();
        });
      } catch (e) {
        console.warn('Failed to register close listener:', e);
      }
    }

    // Skip if already bootstrapped (e.g., HMR)
    if (isBootstrapped()) {
      ready = true;
      return;
    }

    try {
      // Detect browser-only mode (Vite dev server / Playwright e2e) so
      // bootstrap can fall back to memory adapters instead of trying to
      // call Tauri commands that don't exist outside the desktop shell.
      await bootstrap({ useMocks: !isTauri });
      ready = true;
    } catch (e) {
      console.error('Failed to bootstrap application:', e);
      error = e instanceof Error ? e : new Error(String(e));
    }
  });

  onDestroy(() => {
    mediaQuery?.removeEventListener('change', handleMediaChange);
    window.removeEventListener('keydown', handleGlobalKeydown);
    cleanupCloseListener?.();
  });
</script>

{#if isCaptureRoute}
  {@render children()}
{:else}
<div
  class="app-layout-shell"
  class:has-mobile-tabs={platformStore.capabilities.preferredShell === 'mobile'}
  data-shell={platformStore.capabilities.preferredShell}
>
  <div class="desktop-titlebar">
    <AppTitlebar onOpenHelp={() => uiStore.openShortcutSheet()} />
  </div>

  <div class="app-route-frame">
    {#if error}
      <div class="boot-error">
        <div class="boot-card">
          <div class="boot-error-icon">
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.7">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <h1 class="boot-error-title">Couldn't start void</h1>
          <p class="boot-error-msg">{error.message}</p>
          <button class="boot-retry" onclick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    {:else if !ready}
      <div class="boot-loading">
        <div class="boot-loading-mark" aria-hidden="true">
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="16" stroke="currentColor" stroke-width="1" stroke-dasharray="2 4" opacity="0.25"/>
            <circle cx="18" cy="18" r="3" fill="currentColor" opacity="0.6">
              <animate attributeName="opacity" values="0.6;1;0.6" dur="1.6s" repeatCount="indefinite"/>
            </circle>
          </svg>
        </div>
        <p class="boot-loading-label">Preparing your workspace</p>
      </div>
    {:else}
      {@render children()}
    {/if}
  </div>
  <MobileTabBar />
</div>

<ShortcutSheet isOpen={uiStore.shortcutSheetOpen} onClose={() => uiStore.closeShortcutSheet()} />
{/if}

<style>
  .app-layout-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    background: var(--bg-app, #fbfaf7);
    color: var(--text-primary, #1c1b1a);
  }

  .desktop-titlebar {
    flex: 0 0 auto;
  }

  .app-route-frame {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .app-layout-shell.has-mobile-tabs .app-route-frame {
    padding-bottom: calc(62px + env(safe-area-inset-bottom));
  }

  @media (max-width: 639px) {
    .desktop-titlebar {
      display: none;
    }
  }

  .boot-loading,
  .boot-error {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    background: var(--bg-app, #fbfaf7);
    flex-direction: column;
    color: var(--text-primary, #1c1b1a);
    padding: 24px;
  }

  .boot-loading-mark {
    color: var(--accent-primary, #2c5cd5);
    margin-bottom: 16px;
  }

  .boot-loading-label {
    font-size: 13px;
    color: var(--text-tertiary, #84827d);
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
    letter-spacing: -0.003em;
  }

  .boot-card {
    max-width: 380px;
    background: var(--bg-card, #ffffff);
    border: 1px solid var(--border-light, rgba(28, 27, 24, 0.07));
    border-radius: 12px;
    padding: 24px;
    box-shadow: var(--shadow-lg, 0 12px 28px rgba(20, 19, 16, 0.08));
    text-align: center;
  }

  .boot-error-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--color-error-bg, #fbe7e7);
    color: var(--color-error, #c83232);
    margin-bottom: 12px;
  }

  .boot-error-title {
    font-size: 17px;
    font-weight: 600;
    margin: 0 0 6px;
    color: var(--text-primary, #1c1b1a);
    letter-spacing: -0.012em;
  }

  .boot-error-msg {
    font-size: 13px;
    color: var(--text-secondary, #5b5a56);
    margin: 0 0 16px;
    line-height: 1.5;
  }

  .boot-retry {
    padding: 7px 16px;
    background: var(--accent-primary, #2c5cd5);
    color: var(--text-inverse, #ffffff);
    border: none;
    border-radius: 7px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
  }

  .boot-retry:hover {
    background: var(--accent-hover, #1e4bbf);
  }
</style>
