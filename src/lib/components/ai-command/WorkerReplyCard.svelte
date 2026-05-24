<script lang="ts">
  import MarkdownIt from 'markdown-it';
  import { Bot, ChevronDown, ChevronRight, FileText, Layers, Quote } from '@lucide/svelte';
  import type { AgentWorkerMessage } from '$lib/domain/entities/AgentRun';
  import { renderCodeFenceHtml } from '$lib/core/codeFence';

  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    breaks: true,
  });

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    if (!token) return '';
    return renderCodeFenceHtml(token.content, token.info);
  };

  interface Props {
    message: AgentWorkerMessage;
  }

  let { message }: Props = $props();

  type ReplyShape =
    | { kind: 'plain'; text: string }
    | {
        kind: 'synthesis-draft';
        title: string;
        content: string;
        summary: string;
        citationIndexes: number[];
        raw: string;
      }
    | {
        kind: 'worker-result';
        summary: string;
        findings: string[];
        artifactDrafts: Array<{ title?: unknown; type?: unknown }>;
        citations: unknown[];
        risks: string[];
        confidence: number;
        raw: string;
      }
    | {
        kind: 'source-learning';
        noteTitle: string;
        noteContentMarkdown: string;
        summary: string;
        findings: string[];
        risks: string[];
        raw: string;
      }
    | {
        kind: 'model-prior';
        summary: string;
        findings: string[];
        risks: string[];
        confidence: number;
        raw: string;
      }
    | {
        kind: 'outline';
        aspects: Array<{ slug?: string; title?: string; questions?: unknown[] }>;
        raw: string;
      };

  function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  function stringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }

  function numberList(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
  }

  function clampConfidence(value: unknown): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  function tryParseJson(text: string): Record<string, unknown> | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const candidate = trimmed.startsWith('{') ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0];
    if (!candidate) return null;
    try {
      const parsed = JSON.parse(candidate);
      return asRecord(parsed);
    } catch {
      return null;
    }
  }

  function parseWorkerReply(text: string): ReplyShape {
    const parsed = tryParseJson(text);
    if (!parsed) return { kind: 'plain', text };

    const raw = text;

    if ('citationIndexes' in parsed && typeof parsed.title === 'string' && typeof parsed.content === 'string') {
      return {
        kind: 'synthesis-draft',
        title: parsed.title,
        content: parsed.content,
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        citationIndexes: numberList(parsed.citationIndexes),
        raw,
      };
    }

    if (typeof parsed.noteContentMarkdown === 'string') {
      return {
        kind: 'source-learning',
        noteTitle: typeof parsed.noteTitle === 'string' ? parsed.noteTitle : '(untitled note)',
        noteContentMarkdown: parsed.noteContentMarkdown,
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        findings: stringList(parsed.findings),
        risks: stringList(parsed.risks),
        raw,
      };
    }

    if (Array.isArray(parsed.artifactDrafts)) {
      return {
        kind: 'worker-result',
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        findings: stringList(parsed.findings),
        artifactDrafts: parsed.artifactDrafts.filter((d): d is Record<string, unknown> => !!d && typeof d === 'object'),
        citations: Array.isArray(parsed.citations) ? parsed.citations : [],
        risks: stringList(parsed.risks),
        confidence: clampConfidence(parsed.confidence),
        raw,
      };
    }

    if (Array.isArray(parsed.aspects)) {
      const aspects = parsed.aspects
        .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
        .map((a) => {
          const aspect: { slug?: string; title?: string; questions?: unknown[] } = {};
          if (typeof a.slug === 'string') aspect.slug = a.slug;
          if (typeof a.title === 'string') aspect.title = a.title;
          if (Array.isArray(a.questions)) aspect.questions = a.questions;
          return aspect;
        });
      return { kind: 'outline', aspects, raw };
    }

    if (typeof parsed.summary === 'string' && Array.isArray(parsed.findings)) {
      return {
        kind: 'model-prior',
        summary: parsed.summary,
        findings: stringList(parsed.findings),
        risks: stringList(parsed.risks),
        confidence: clampConfidence(parsed.confidence),
        raw,
      };
    }

    return { kind: 'plain', text };
  }

  let chatText = $derived.by(() => {
    const data = asRecord(message.data);
    const response = asRecord(data?.response);
    const chat = response?.chat;
    return typeof chat === 'string' ? chat : message.message;
  });

  let toolCalls = $derived.by(() => {
    const data = asRecord(message.data);
    const response = asRecord(data?.response);
    return Array.isArray(response?.toolCalls) ? response.toolCalls : [];
  });

  let reply = $derived(parseWorkerReply(chatText));

  let contentOpen = $state(false);
  let plainExpanded = $state(false);
  let rawOpen = $state(false);

  let renderedPlain = $derived(
    reply.kind === 'plain' ? md.render(reply.text || '(empty response)') : ''
  );
  let renderedDraftContent = $derived(
    reply.kind === 'synthesis-draft'
      ? md.render(reply.content)
      : reply.kind === 'source-learning'
        ? md.render(reply.noteContentMarkdown)
        : ''
  );

  let plainNeedsTruncation = $derived(renderedPlain.length > 2200);

  function formatTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function pct(value: number): string {
    return `${Math.round(value * 100)}%`;
  }
</script>

<div class="reply-card">
  {#if reply.kind === 'synthesis-draft' || reply.kind === 'source-learning'}
    <header class="reply-head">
      <span class="reply-icon" aria-hidden="true"><FileText size={13} strokeWidth={1.9} /></span>
      <span class="reply-label">Drafted note</span>
      <time>{formatTime(message.createdAt)}</time>
    </header>
    <div class="reply-body">
      <strong class="draft-title">
        {reply.kind === 'synthesis-draft' ? reply.title : reply.noteTitle}
      </strong>
      {#if reply.summary}
        <p class="draft-summary">{reply.summary}</p>
      {/if}
      <div class="reply-chips">
        {#if reply.kind === 'synthesis-draft' && reply.citationIndexes.length > 0}
          <span class="chip">
            <Quote size={11} strokeWidth={1.9} aria-hidden="true" />
            {reply.citationIndexes.length} citation{reply.citationIndexes.length === 1 ? '' : 's'}
          </span>
        {/if}
        {#if reply.kind === 'source-learning' && reply.findings.length > 0}
          <span class="chip">{reply.findings.length} finding{reply.findings.length === 1 ? '' : 's'}</span>
        {/if}
        {#if reply.kind === 'source-learning' && reply.risks.length > 0}
          <span class="chip" data-tone="warn">{reply.risks.length} risk{reply.risks.length === 1 ? '' : 's'}</span>
        {/if}
      </div>
      <button
        type="button"
        class="reply-expander"
        onclick={() => (contentOpen = !contentOpen)}
        aria-expanded={contentOpen}
      >
        {#if contentOpen}
          <ChevronDown size={12} strokeWidth={1.9} aria-hidden="true" />
        {:else}
          <ChevronRight size={12} strokeWidth={1.9} aria-hidden="true" />
        {/if}
        <span>{contentOpen ? 'Hide content' : 'Show content'}</span>
      </button>
      {#if contentOpen}
        <div class="draft-content markdown-body">{@html renderedDraftContent}</div>
      {/if}
    </div>
  {:else if reply.kind === 'worker-result'}
    <header class="reply-head">
      <span class="reply-icon" aria-hidden="true"><Bot size={13} strokeWidth={1.9} /></span>
      <span class="reply-label">Worker reply</span>
      <time>{formatTime(message.createdAt)}</time>
    </header>
    <div class="reply-body">
      {#if reply.summary}
        <p class="reply-summary">{reply.summary}</p>
      {/if}
      {#if reply.findings.length > 0}
        <ul class="reply-findings">
          {#each reply.findings.slice(0, 5) as finding}
            <li>{finding}</li>
          {/each}
          {#if reply.findings.length > 5}
            <li class="reply-findings-more">+{reply.findings.length - 5} more</li>
          {/if}
        </ul>
      {/if}
      <div class="reply-chips">
        {#if reply.artifactDrafts.length > 0}
          <span class="chip">{reply.artifactDrafts.length} draft{reply.artifactDrafts.length === 1 ? '' : 's'}</span>
        {/if}
        {#if reply.citations.length > 0}
          <span class="chip">{reply.citations.length} citation{reply.citations.length === 1 ? '' : 's'}</span>
        {/if}
        {#if reply.confidence > 0}
          <span class="chip">{pct(reply.confidence)} confidence</span>
        {/if}
        {#if reply.risks.length > 0}
          <span class="chip" data-tone="warn">{reply.risks.length} risk{reply.risks.length === 1 ? '' : 's'}</span>
        {/if}
      </div>
    </div>
  {:else if reply.kind === 'model-prior'}
    <header class="reply-head">
      <span class="reply-icon" aria-hidden="true"><Bot size={13} strokeWidth={1.9} /></span>
      <span class="reply-label">Worker reply <em>(model-prior)</em></span>
      <time>{formatTime(message.createdAt)}</time>
    </header>
    <div class="reply-body">
      {#if reply.summary}
        <p class="reply-summary">{reply.summary}</p>
      {/if}
      {#if reply.findings.length > 0}
        <ul class="reply-findings">
          {#each reply.findings.slice(0, 5) as finding}
            <li>{finding}</li>
          {/each}
          {#if reply.findings.length > 5}
            <li class="reply-findings-more">+{reply.findings.length - 5} more</li>
          {/if}
        </ul>
      {/if}
      <div class="reply-chips">
        {#if reply.confidence > 0}
          <span class="chip">{pct(reply.confidence)} confidence</span>
        {/if}
        {#if reply.risks.length > 0}
          <span class="chip" data-tone="warn">{reply.risks.length} risk{reply.risks.length === 1 ? '' : 's'}</span>
        {/if}
      </div>
    </div>
  {:else if reply.kind === 'outline'}
    <header class="reply-head">
      <span class="reply-icon" aria-hidden="true"><Layers size={13} strokeWidth={1.9} /></span>
      <span class="reply-label">Plan: {reply.aspects.length} aspect{reply.aspects.length === 1 ? '' : 's'}</span>
      <time>{formatTime(message.createdAt)}</time>
    </header>
    <div class="reply-body">
      <ul class="outline-list">
        {#each reply.aspects as aspect}
          <li>
            {#if aspect.slug}
              <code>{aspect.slug}</code>
            {/if}
            <strong>{aspect.title ?? '(untitled aspect)'}</strong>
            {#if aspect.questions && aspect.questions.length > 0}
              <span>· {aspect.questions.length} question{aspect.questions.length === 1 ? '' : 's'}</span>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {:else}
    <header class="reply-head">
      <span class="reply-icon" aria-hidden="true"><Bot size={13} strokeWidth={1.9} /></span>
      <span class="reply-label">Worker</span>
      <time>{formatTime(message.createdAt)}</time>
    </header>
    <div class="reply-body markdown-body" class:plain-truncated={plainNeedsTruncation && !plainExpanded}>
      {@html renderedPlain}
    </div>
    {#if plainNeedsTruncation}
      <button
        type="button"
        class="reply-expander"
        onclick={() => (plainExpanded = !plainExpanded)}
        aria-expanded={plainExpanded}
      >
        {#if plainExpanded}
          <ChevronDown size={12} strokeWidth={1.9} aria-hidden="true" />
        {:else}
          <ChevronRight size={12} strokeWidth={1.9} aria-hidden="true" />
        {/if}
        <span>{plainExpanded ? 'Collapse reply' : 'Show full reply'}</span>
      </button>
    {/if}
    {#if toolCalls.length > 0}
      <div class="reply-toolcalls">{toolCalls.length} tool call{toolCalls.length === 1 ? '' : 's'} (see Tool result entries below)</div>
    {/if}
  {/if}

  {#if reply.kind !== 'plain'}
    <details class="reply-raw" bind:open={rawOpen}>
      <summary>
        {rawOpen ? 'Hide raw JSON' : 'View raw JSON'}
      </summary>
      <pre>{reply.raw}</pre>
    </details>
  {/if}
</div>

<style>
  .reply-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
  }

  .reply-head {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--ai-accent);
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: var(--text-label-tracking, 0.04em);
    text-transform: uppercase;
  }

  .reply-head time {
    margin-left: auto;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
  }

  .reply-icon {
    display: inline-flex;
    color: inherit;
  }

  .reply-label em {
    color: var(--text-muted);
    font-style: normal;
    font-weight: 500;
  }

  .reply-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: var(--text-primary);
    font-size: 13px;
    line-height: 1.55;
  }

  .draft-title {
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 650;
    line-height: 1.3;
  }

  .draft-summary,
  .reply-summary {
    margin: 0;
    color: var(--text-secondary);
    font-size: 12.5px;
    line-height: 1.5;
  }

  .reply-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 7px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-editor);
    color: var(--text-muted);
    font-size: 10.5px;
  }

  .chip[data-tone='warn'] {
    border-color: color-mix(in srgb, var(--color-warning) 35%, var(--border-light));
    background: var(--color-warning-bg);
    color: var(--color-warning);
  }

  .reply-expander {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    align-self: flex-start;
    padding: 4px 8px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .reply-expander:hover {
    border-color: var(--border-medium);
    color: var(--text-primary);
  }

  .draft-content {
    max-height: 480px;
    overflow-y: auto;
    margin-top: 4px;
    padding: 12px;
    border-radius: var(--radius-sm);
    background: var(--bg-editor);
    color: var(--text-primary);
    font-size: 12.5px;
    line-height: 1.55;
  }

  .reply-findings {
    margin: 0;
    padding-left: 18px;
  }

  .reply-findings li {
    color: var(--text-secondary);
    font-size: 12.5px;
    line-height: 1.45;
  }

  .reply-findings-more {
    color: var(--text-muted);
    font-style: italic;
  }

  .outline-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .outline-list li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    padding: 6px 8px;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-sm);
    background: var(--bg-editor);
  }

  .outline-list code {
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--bg-card);
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    font-size: 10.5px;
  }

  .outline-list strong {
    color: var(--text-primary);
    font-size: 12.5px;
    font-weight: 600;
  }

  .outline-list span {
    color: var(--text-muted);
    font-size: 11px;
  }

  .plain-truncated {
    position: relative;
    max-height: 220px;
    overflow: hidden;
    mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
    -webkit-mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
  }

  .reply-toolcalls {
    color: var(--text-muted);
    font-size: 11px;
  }

  .reply-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--border-faint);
    padding-top: 6px;
  }

  .reply-raw summary {
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .reply-raw[open] summary {
    margin-bottom: 6px;
    color: var(--text-secondary);
  }

  .reply-raw pre {
    max-height: 280px;
    overflow: auto;
    margin: 0;
    padding: 10px;
    border-radius: var(--radius-sm);
    background: var(--bg-editor);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .markdown-body :global(p) {
    margin: 0 0 8px;
  }

  .markdown-body :global(p:last-child) {
    margin-bottom: 0;
  }

  .markdown-body :global(h1),
  .markdown-body :global(h2),
  .markdown-body :global(h3) {
    margin: 8px 0 4px;
    color: var(--text-primary);
    font-weight: 650;
  }

  .markdown-body :global(h1) {
    font-size: 15px;
  }

  .markdown-body :global(h2) {
    font-size: 13.5px;
  }

  .markdown-body :global(h3) {
    font-size: 12.5px;
  }

  .markdown-body :global(ul),
  .markdown-body :global(ol) {
    margin: 0 0 8px;
    padding-left: 20px;
  }

  .markdown-body :global(code) {
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--bg-editor);
    font-family: var(--font-mono);
    font-size: 0.92em;
  }

  .markdown-body :global(pre) {
    overflow-x: auto;
    margin: 8px 0;
    padding: 10px;
    border-radius: var(--radius-sm);
    background: var(--bg-editor);
  }

  .markdown-body :global(pre code) {
    padding: 0;
    background: transparent;
  }

  .markdown-body :global(a) {
    color: var(--ai-accent);
    text-decoration: underline;
  }
</style>
