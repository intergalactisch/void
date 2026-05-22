<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import type { CLIProviderId } from '$lib/domain';
  import { aiStore } from '$lib/stores';

  interface Props {
    selectedProvider: CLIProviderId;
  }

  interface CLIAvailability {
    claude: boolean;
    codex: boolean;
    claude_path?: string;
    claudePath?: string;
    claude_version?: string;
    claudeVersion?: string;
    codex_flavor?: string;
    codexFlavor?: string;
    codex_path?: string;
    codexPath?: string;
    codex_version?: string;
    codexVersion?: string;
  }

  interface ProviderDetail {
    id: CLIProviderId;
    label: string;
    available: boolean;
    version: string | undefined;
    path: string | undefined;
    contract: string | undefined;
  }

  let { selectedProvider }: Props = $props();

  let availability = $state<CLIAvailability | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  function field(record: CLIAvailability | null, snake: keyof CLIAvailability, camel: keyof CLIAvailability): string | undefined {
    if (!record) return undefined;
    const value = record[snake] ?? record[camel];
    return typeof value === 'string' && value.trim() ? value : undefined;
  }

  function codexContractLabel(flavor: string | undefined): string {
    if (flavor === 'exec') return 'Keyless exec';
    if (flavor === 'legacy') return 'Legacy quiet';
    if (flavor === 'api-key-only') return 'Unsupported legacy';
    return 'Unknown';
  }

  let providers = $derived<ProviderDetail[]>([
    {
      id: 'codex',
      label: 'Codex CLI',
      available: availability?.codex ?? false,
      version: field(availability, 'codex_version', 'codexVersion'),
      path: field(availability, 'codex_path', 'codexPath'),
      contract: codexContractLabel(field(availability, 'codex_flavor', 'codexFlavor')),
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      available: availability?.claude ?? false,
      version: field(availability, 'claude_version', 'claudeVersion'),
      path: field(availability, 'claude_path', 'claudePath'),
      contract: availability?.claude ? 'Local CLI' : undefined,
    },
  ]);

  async function loadAvailability() {
    loading = true;
    error = null;
    try {
      availability = await invoke<CLIAvailability>('check_cli_available');
      if (aiStore.isInitialized) {
        void aiStore.refreshAvailability();
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void loadAvailability();
  });
</script>

<div class="cli-details" aria-live="polite">
  <div class="cli-details-header">
    <div class="cli-details-title">Detected CLI tools</div>
    <button
      type="button"
      class="cli-refresh"
      onclick={loadAvailability}
      disabled={loading}
    >
      {loading ? 'Checking...' : 'Refresh'}
    </button>
  </div>

  {#if error}
    <div class="cli-error">{error}</div>
  {:else}
    <div class="cli-list">
      {#each providers as provider}
        <div
          class="cli-row"
          class:cli-row-selected={provider.id === selectedProvider}
        >
          <div
            class="cli-dot"
            class:cli-dot-ok={provider.available}
            class:cli-dot-missing={!provider.available}
            aria-hidden="true"
          ></div>
          <div class="cli-main">
            <div class="cli-row-top">
              <span class="cli-name">{provider.label}</span>
              {#if provider.id === selectedProvider}
                <span class="cli-badge cli-badge-selected">Using</span>
              {/if}
              <span
                class="cli-badge"
                class:cli-badge-ok={provider.available}
                class:cli-badge-missing={!provider.available}
              >
                {provider.available ? 'Found' : 'Missing'}
              </span>
              {#if provider.contract}
                <span
                  class="cli-badge"
                  class:cli-badge-warning={provider.contract === 'Unsupported legacy'}
                >
                  {provider.contract}
                </span>
              {/if}
            </div>
            <div class="cli-meta">
              {#if provider.version}
                <span>{provider.version}</span>
              {:else if provider.available}
                <span>Version unknown</span>
              {:else}
                <span>Not found on PATH</span>
              {/if}
            </div>
            {#if provider.path}
              <div class="cli-path" title={provider.path}>{provider.path}</div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .cli-details {
    margin-top: 10px;
    padding: 10px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-subtle, var(--bg-card));
  }

  .cli-details-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }

  .cli-details-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .cli-refresh {
    padding: 4px 8px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm, 4px);
    background: var(--bg-card);
    color: var(--text-secondary);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
  }

  .cli-refresh:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--border-medium);
  }

  .cli-refresh:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .cli-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .cli-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--border-faint, var(--border-light));
    border-radius: var(--radius-sm, 4px);
    background: var(--bg-card);
  }

  .cli-row-selected {
    border-color: var(--accent-primary);
    background: var(--accent-light, var(--bg-card));
  }

  .cli-dot {
    width: 8px;
    height: 8px;
    margin-top: 5px;
    border-radius: 50%;
  }

  .cli-dot-ok {
    background: var(--color-success, #16a34a);
  }

  .cli-dot-missing {
    background: var(--text-muted, #9ca3af);
  }

  .cli-main {
    min-width: 0;
  }

  .cli-row-top {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
  }

  .cli-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .cli-badge {
    padding: 1px 5px;
    border-radius: var(--radius-sm, 4px);
    background: var(--bg-hover, var(--bg-subtle));
    color: var(--text-tertiary, var(--text-secondary));
    font-size: 11px;
    font-weight: 600;
  }

  .cli-badge-selected {
    background: var(--accent-primary);
    color: var(--text-inverse);
  }

  .cli-badge-ok {
    color: var(--color-success, #16a34a);
  }

  .cli-badge-missing,
  .cli-badge-warning {
    color: var(--color-warning, #a16207);
  }

  .cli-meta {
    margin-top: 3px;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .cli-path {
    margin-top: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary, var(--text-secondary));
  }

  .cli-error {
    padding: 8px;
    border-radius: var(--radius-sm, 4px);
    background: var(--color-error-bg);
    color: var(--color-error);
    font-size: 12px;
  }
</style>
