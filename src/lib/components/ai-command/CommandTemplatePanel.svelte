<script lang="ts">
  import { Play, Sparkles, X } from '@lucide/svelte';
  import { aiStore, commandCenterStore } from '$lib/stores';
  import type { OperationTemplate } from '$lib/domain/values/OperationTemplate';

  let selectedTemplate = $state<OperationTemplate | null>(null);
  let values = $state<Record<string, string>>({});

  let templates = $derived(aiStore.templates);

  function selectTemplate(template: OperationTemplate) {
    selectedTemplate = template;
    values = {};
    for (const variable of template.variables) {
      values[variable.name] = variable.default?.toString() ?? '';
    }
  }

  async function runSelected() {
    if (!selectedTemplate) return;
    await aiStore.queueFromTemplate(selectedTemplate.id, values);
    selectedTemplate = null;
    values = {};
    commandCenterStore.closeTemplates();
  }
</script>

<div class="template-panel">
  <div class="panel-head">
    <h3>Action Templates</h3>
    <span>{templates.length} available</span>
  </div>

  {#if selectedTemplate}
    <form class="template-form" onsubmit={(event) => { event.preventDefault(); void runSelected(); }}>
      <div class="selected-head">
        <div>
          <h4>{selectedTemplate.name}</h4>
          <p>{selectedTemplate.description}</p>
        </div>
        <button type="button" class="icon-button" aria-label="Close template form" onclick={() => { selectedTemplate = null; }}>
          <X size={14} strokeWidth={1.8} />
        </button>
      </div>

      {#each selectedTemplate.variables as variable}
        <label class="field" for={`command-template-${variable.name}`}>
          <span>{variable.name}</span>
          <input
            id={`command-template-${variable.name}`}
            name={variable.name}
            type="text"
            placeholder={variable.description}
            bind:value={values[variable.name]}
            required={variable.required}
          />
        </label>
      {/each}

      <div class="form-actions">
        <button type="button" class="secondary" onclick={() => { selectedTemplate = null; }}>Cancel</button>
        <button type="submit" class="primary">
          <Play size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>Run</span>
        </button>
      </div>
    </form>
  {:else if templates.length === 0}
    <div class="empty">
      <Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />
      <span>No templates available</span>
    </div>
  {:else}
    <div class="template-list" role="list">
      {#each templates as template (template.id)}
        <button type="button" class="template-row" onclick={() => selectTemplate(template)}>
          <Sparkles size={15} strokeWidth={1.8} aria-hidden="true" />
          <span class="template-main">
            <strong>{template.name}</strong>
            <span>{template.description}</span>
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .template-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .panel-head,
  .selected-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }

  .panel-head h3,
  .selected-head h4 {
    margin: 0;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 650;
  }

  .panel-head span,
  .selected-head p {
    margin: 0;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.4;
  }

  .template-list,
  .template-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .template-row {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    gap: 8px;
    width: 100%;
    padding: 9px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .template-row:hover {
    border-color: var(--border-medium);
    background: var(--bg-hover);
  }

  .template-row :global(svg) {
    color: var(--ai-accent);
  }

  .template-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .template-main strong,
  .template-main span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .template-main strong {
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 600;
  }

  .template-main span {
    color: var(--text-muted);
    font-size: 10.5px;
  }

  .template-form {
    padding: 10px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
  }

  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .icon-button:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
  }

  .field input {
    width: 100%;
    height: 32px;
    padding: 0 9px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-app);
    color: var(--text-primary);
    font: inherit;
    font-size: 12px;
  }

  .field input:focus {
    border-color: var(--ai-accent);
    box-shadow: 0 0 0 3px var(--ai-accent-light);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  .primary,
  .secondary {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    font: inherit;
    font-size: 11px;
    font-weight: 650;
    cursor: pointer;
  }

  .primary {
    border: 0;
    background: var(--ai-accent);
    color: var(--text-inverse);
  }

  .secondary {
    border: 1px solid var(--border-light);
    background: var(--bg-card);
    color: var(--text-secondary);
  }

  .empty {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px;
    color: var(--text-muted);
    font-size: 12px;
  }
</style>
