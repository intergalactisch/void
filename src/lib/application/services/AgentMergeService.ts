/**
 * AgentMergeService - turns worker outputs into one orchestrator write plan.
 */

import type {
  AgentArtifactDraft,
  AgentMergeState,
  AgentResearchEvidenceLevel,
  AgentRun,
  AgentWorkerResult,
  ResearchCitation,
} from '$lib/domain/entities/AgentRun';
import { classifyDurableAgentPrompt } from '$lib/domain/values/AgentPromptIntent';
import { deriveResearchTopic } from '$lib/domain/values/ResearchTopic';

export interface AgentMergeInput {
  run: AgentRun;
  workerResults: AgentWorkerResult[];
  workerFailures: Array<{ workerId: string; error: Error }>;
}

export class AgentMergeService {
  merge(input: AgentMergeInput): AgentMergeState {
    const researchRun = isResearchRun(input.run.prompt);
    const rawDrafts = input.workerResults.flatMap((result) => result.artifactDrafts);
    const rejectedDraftCount = rawDrafts.filter((draft) => !isSubstantiveDraft(draft)).length;
    let artifactDrafts = dedupeDrafts(rawDrafts.filter(isSubstantiveDraft));
    const evidenceLevel = researchEvidenceLevel(input.run, input.workerResults);
    if (researchRun && artifactDrafts.length === 0) {
      artifactDrafts = [buildResearchOverviewDraft(input.run, input.workerResults, evidenceLevel)];
    }
    const risks = unique([
      ...input.workerResults.flatMap((result) => result.risks),
      ...input.workerFailures.map((failure) => `${failure.workerId}: ${failure.error.message}`),
      ...(rejectedDraftCount > 0
        ? [`Ignored ${rejectedDraftCount} placeholder worker draft${rejectedDraftCount === 1 ? '' : 's'} during merge.`]
        : []),
      ...(researchRun && evidenceLevel !== 'verified_sources'
        ? [researchEvidenceRisk(evidenceLevel)]
        : []),
    ]).slice(0, 12);
    const sourceWorkerIds = input.workerResults.map((result) => result.workerId);
    const touchedExistingNotes = artifactDrafts
      .filter((draft) => draft.type === 'diff' && draft.path)
      .map((draft) => draft.path!)
      .filter(uniquePredicate);

    const summary = [
      `Merged ${input.workerResults.length} worker result${input.workerResults.length === 1 ? '' : 's'}.`,
      input.workerFailures.length > 0
        ? `${input.workerFailures.length} worker${input.workerFailures.length === 1 ? '' : 's'} failed or were blocked.`
        : 'All workers completed.',
      artifactDrafts.length > 0
        ? `${artifactDrafts.length} draft artifact${artifactDrafts.length === 1 ? '' : 's'} ready for orchestrator write planning.`
        : researchRun
          ? 'A best-available research artifact will be created by the orchestrator.'
          : 'No draft artifacts were produced, so the orchestrator will create a concise summary note.',
    ].join(' ');

    const state: AgentMergeState = {
      status: 'completed',
      summary,
      writePrompt: buildWritePrompt(input.run, input.workerResults, input.workerFailures, artifactDrafts, risks),
      sourceWorkerIds,
      artifactDrafts,
      touchedExistingNotes,
      risks,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    if (researchRun) state.evidenceLevel = evidenceLevel;
    return state;
  }
}

export function isResearchPlaceholderDraft(draft: AgentArtifactDraft): boolean {
  if (draft.metadata?.quality === 'placeholder' || draft.metadata?.quality === 'insufficient') return true;
  if (looksLikePlaceholderTitle(draft.title)) return true;
  const body = [draft.content, draft.summary].filter(hasText).join('\n');
  return looksLikeGenericCompletion(body);
}

export function isSubstantiveDraft(draft: AgentArtifactDraft): boolean {
  if (isResearchPlaceholderDraft(draft)) return false;
  const body = [draft.content, draft.summary].filter(hasText).join('\n');
  if (draft.type === 'diff') return hasText(draft.path) && wordCount(body) >= 4;
  if (draft.type === 'media') return hasText(draft.url);
  if (draft.type === 'note' || draft.type === 'summary') {
    return wordCount(body) >= 8 || hasResearchTitle(draft.title);
  }
  return true;
}

function buildWritePrompt(
  run: AgentRun,
  results: AgentWorkerResult[],
  failures: Array<{ workerId: string; error: Error }>,
  drafts: AgentArtifactDraft[],
  risks: string[]
): string {
  const researchRun = isResearchRun(run.prompt);
  const suggestedFolder = run.plan?.suggestedFolder ?? suggestFolder(run.prompt);
  const workerSections = results.map((result) => [
    `## Worker ${result.workerId}: ${result.title}`,
    `Summary: ${result.summary}`,
    '',
    'Findings:',
    ...result.findings.map((finding) => `- ${finding}`),
    result.citations.length > 0 ? '\nCitations:' : '',
    ...result.citations.map((citation) => `- ${citation.title}: ${citation.url} (${citation.fetchedAt}) ${citation.excerpt ?? ''}`),
    result.nextActions.length > 0 ? '\nNext actions:' : '',
    ...result.nextActions.map((action) => `- ${action}`),
  ].filter(Boolean).join('\n')).join('\n\n');

  const draftSections = drafts.map((draft) => [
    `## Draft ${draft.id}: ${draft.title}`,
    `Type: ${draft.type}`,
    draft.mediaKind ? `Media kind: ${draft.mediaKind}` : '',
    draft.path ? `Path: ${draft.path}` : '',
    draft.url ? `URL: ${draft.url}` : '',
    draft.thumbnailUrl ? `Thumbnail: ${draft.thumbnailUrl}` : '',
    draft.summary ? `Summary: ${draft.summary}` : '',
    draft.content ? `Content:\n${draft.content}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');

  const failureSection = failures.length > 0
    ? failures.map((failure) => `- ${failure.workerId}: ${failure.error.message}`).join('\n')
    : '- None';
  const riskSection = risks.length > 0
    ? risks.map((risk) => `- ${risk}`).join('\n')
    : '- None';

  return [
    'You are the main Void orchestrator. Apply the merged worker output using app tools.',
    '',
    `Original user request: ${run.prompt}`,
    `Target folder: ${suggestedFolder}`,
    '',
    'Safety and ownership:',
    '- Worker outputs are drafts. You are responsible for final writes.',
    '- Use note:create and note:update tools only when they clearly satisfy the user request.',
    '- Do not claim files were created or updated unless the corresponding app tool has succeeded.',
    researchRun
      ? '- For research requests, write learning notes about the topic itself: what the reader can understand, remember, compare, and study next.'
      : '- Create a concise overview note by default, plus supporting notes only when worker drafts are substantial.',
    researchRun
      ? '- Keep worker failures, run receipts, and methodology diagnostics out of user-facing notes; keep them in the run state only.'
      : '- Preserve citations, caveats, failed-worker notes, and open questions in the written artifact.',
    '- Do not delete, move, or overwrite existing user content unless the original user request explicitly asked for that exact destructive action.',
    '- Use autoFocus false for background notes and open/focus the final overview note at the end if a tool supports it.',
    '',
    'Worker results:',
    workerSections || 'No worker results were completed.',
    '',
    'Draft artifacts:',
    draftSections || 'No draft artifacts. Create a compact synthesis note from the available findings.',
    '',
    'Worker failures:',
    failureSection,
    '',
    'Risks and caveats to preserve:',
    riskSection,
    '',
    'After writing, provide a concise final completion summary listing created/updated notes, key findings, and unresolved follow-ups.',
  ].join('\n');
}

function dedupeDrafts(drafts: AgentArtifactDraft[]): AgentArtifactDraft[] {
  const seen = new Set<string>();
  const result: AgentArtifactDraft[] = [];
  for (const draft of drafts) {
    const key = `${draft.type}:${draft.url ?? draft.path ?? draft.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(draft);
  }
  return result;
}

function buildResearchOverviewDraft(
  run: AgentRun,
  results: AgentWorkerResult[],
  evidenceLevel: AgentResearchEvidenceLevel
): AgentArtifactDraft {
  const topic = deriveResearchTopic(run.prompt);
  const title = topic.overviewTitle;
  const citations = collectResearchCitations(run, results);
  const verifiedSources = citations.filter(isVerifiedCitation);
  const sourceLeads = citations.filter((citation) => !isVerifiedCitation(citation));
  const mediaLeads = uniqueMediaDrafts(results.flatMap((result) => result.artifactDrafts));
  const citationFindings = citationBackedFindings([...verifiedSources, ...sourceLeads]);
  const findings = unique(results.flatMap((result) => result.findings))
    .filter(hasText)
    .filter((finding) => !looksLikeGenericCompletion(finding))
    .filter((finding) => !isProcessResearchDiagnostic(finding))
    .concat(citationFindings)
    .slice(0, 12);
  const risks = unique(results.flatMap((result) => result.risks))
    .filter(hasText)
    .filter((risk) => !isProcessResearchDiagnostic(risk))
    .slice(0, 8);
  const nextActions = unique(results.flatMap((result) => result.nextActions))
    .filter(hasText)
    .filter((action) => !isProcessResearchDiagnostic(action))
    .slice(0, 8);
  const lines = buildFallbackResearchNote({
    title,
    topic: topic.displayTitle,
    evidenceLevel,
    findings,
    verifiedSources,
    sourceLeads,
    mediaLeads,
    risks,
    nextActions,
  });

  return {
    id: `draft_orchestrator_research_overview_${Date.now()}`,
    workerId: 'orchestrator',
    type: 'note',
    title,
    content: lines.join('\n'),
    summary: `Best-available research overview for ${topic.displayTitle}`,
    confidence: evidenceLevel === 'verified_sources' ? 0.65 : evidenceLevel === 'scaffold_only' ? 0.35 : 0.5,
    createdAt: new Date().toISOString(),
    metadata: {
      quality: 'substantive',
      researchStatus: evidenceLevel === 'verified_sources' ? 'source_backed' : evidenceLevel === 'scaffold_only' ? 'seed' : 'needs_verification',
      evidenceLevel,
      citations,
      mediaLeads,
    },
  };
}

interface LearningNoteInput {
  title: string;
  topic: string;
  evidenceLevel: AgentResearchEvidenceLevel;
  findings: string[];
  verifiedSources: ResearchCitation[];
  sourceLeads: ResearchCitation[];
  mediaLeads: AgentArtifactDraft[];
  risks: string[];
  nextActions: string[];
}

function buildFallbackResearchNote(input: LearningNoteInput): string[] {
  const hasEvidence = input.findings.length > 0 || input.verifiedSources.length > 0 || input.sourceLeads.length > 0;
  const lines = [
    `# ${input.title}`,
    '',
    '## Learning Note',
    hasEvidence
      ? `${input.topic} is collected here as a topic note. The available findings and sources are grouped below as learning material.`
      : `${input.topic} is the subject of this topic note. There is not enough reliable content captured yet for strong conclusions, so this starts with focused learning questions.`,
    '',
    '## Key Takeaways',
    ...learningParagraphs(input.findings, input.topic),
    '',
    '## Source Context',
    ...sourceLearningParagraphs(input.verifiedSources),
  ];

  if (input.sourceLeads.length > 0) {
    lines.push(
      '',
      '## Source Leads To Verify',
      ...sourceLearningParagraphs(input.sourceLeads)
    );
  }

  if (input.mediaLeads.length > 0) {
    lines.push('', '## Media To Review', ...input.mediaLeads.map((draft) => mediaDraftLine(draft)));
  }

  lines.push(
    '',
    '## Further Learning',
    ...(input.risks.length > 0 || input.nextActions.length > 0
      ? [
          ...input.risks.map((risk) => `- ${risk}`),
          ...input.nextActions.map((action) => `- ${action}`),
        ]
      : fallbackLearningQuestions(input.topic, input.evidenceLevel)),
    '',
    '## Sources',
    ...sourceReferenceLines(input.verifiedSources)
  );

  if (input.sourceLeads.length > 0) {
    lines.push('', '## Source Leads', ...sourceReferenceLines(input.sourceLeads));
  }

  return lines;
}

function learningParagraphs(findings: string[], topic: string): string[] {
  const clean = findings
    .map(cleanLearningText)
    .filter(hasText)
    .filter((finding) => !isProcessResearchDiagnostic(finding))
    .slice(0, 8);
  if (clean.length === 0) {
    return [`*No substantive findings captured for ${topic}. Rerun with web access or a more specific prompt.*`];
  }

  return clean.map((finding) => `${finding}${/[.!?]$/.test(finding) ? '' : '.'}`);
}

function sourceLearningParagraphs(citations: ResearchCitation[]): string[] {
  if (citations.length === 0) {
    return ['No sources with usable learning content are attached to this section yet.'];
  }

  return citations.slice(0, 8).map((citation) => {
    const title = citation.title.trim();
    const excerpt = cleanLearningText(citation.excerpt ?? '');
    if (excerpt) {
      return `### ${title}\n${excerpt}${/[.!?]$/.test(excerpt) ? '' : '.'}`;
    }
    return `### ${title}\nThis source is relevant for further study, but no usable excerpt has been captured yet.`;
  });
}

function sourceReferenceLines(citations: ResearchCitation[]): string[] {
  if (citations.length === 0) {
    return ['- No verified sources captured yet.'];
  }

  return citations.slice(0, 12).map((citation) => {
    const fetched = citation.fetchedAt ? ` | ${citation.fetchedAt}` : '';
    return `- [${citation.title}](${citation.url})${fetched}`;
  });
}

function fallbackLearningQuestions(
  topic: string,
  _evidenceLevel: AgentResearchEvidenceLevel
): string[] {
  return [`*No follow-ups captured for ${topic}. Rerun with web access for live sources.*`];
}

function cleanLearningText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^Source identified for review:\s*/i, '')
    .trim();
}

function isProcessResearchDiagnostic(text: string): boolean {
  const normalized = text.toLowerCase();
  return /\b(draft artifact|source recovery|source lookup|source lead recovery|native web|tool result)\b/.test(normalized) ||
    /did not return structured|no draft artifact|recovered sources still need human review|review recovered sources|verify each source lead|run a deeper source-backed pass|transparent seed note|worker did not return/.test(normalized);
}

function unique<T>(items: T[]): T[] {
  return items.filter(uniquePredicate);
}

function uniquePredicate<T>(item: T, index: number, items: T[]): boolean {
  return items.indexOf(item) === index;
}

function suggestFolder(prompt: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `Research/${deriveResearchTopic(prompt).slug} ${date}`;
}

function isResearchRun(prompt: string): boolean {
  return classifyDurableAgentPrompt(prompt)?.mode === 'research';
}

function hasText(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function researchEvidenceLevel(run: AgentRun, results: AgentWorkerResult[]): AgentResearchEvidenceLevel {
  const citations = collectResearchCitations(run, results);
  if (citations.some(isVerifiedCitation)) return 'verified_sources';
  if (citations.length > 0) return 'unverified_leads';
  if (results.some((result) => result.artifactDrafts.some((draft) => draft.type === 'media' && hasText(draft.url)))) return 'unverified_leads';
  if ((run.plan?.existingNotes.length ?? 0) > 0) return 'vault_context';
  if (results.some((result) =>
    result.findings.some((finding) => hasText(finding) && !looksLikeGenericCompletion(finding)) ||
    result.artifactDrafts.some(isSubstantiveDraft)
  )) {
    return 'model_prior';
  }
  return 'scaffold_only';
}

function researchEvidenceRisk(level: AgentResearchEvidenceLevel): string {
  switch (level) {
    case 'unverified_leads':
      return 'Research output includes unverified source leads; verify them before treating claims as sourced.';
    case 'vault_context':
      return 'Research output is based on existing vault context without verified external citations.';
    case 'model_prior':
      return 'Research output includes model-prior synthesis without verified external citations.';
    case 'scaffold_only':
      return 'Research workers did not produce substantive findings, citations, or existing-note evidence; the orchestrator will write a transparent seed note.';
    case 'verified_sources':
      return 'Verified source-backed research output.';
  }
}

function evidenceStatusText(
  level: AgentResearchEvidenceLevel,
  verifiedCount: number,
  leadCount: number
): string {
  switch (level) {
    case 'verified_sources':
      return `Source-backed: ${verifiedCount} verified source${verifiedCount === 1 ? '' : 's'} captured for review.`;
    case 'unverified_leads':
      return `Needs verification: ${leadCount} source lead${leadCount === 1 ? '' : 's'} captured, but no source was verified.`;
    case 'vault_context':
      return 'Vault-context only: related local notes were available, but no verified external citations were captured.';
    case 'model_prior':
      return 'Model-prior synthesis: no verified external citations were captured, so findings must be treated as hypotheses until checked.';
    case 'scaffold_only':
      return 'Scaffold only: no verified sources, source leads, vault matches, or substantive worker findings were captured.';
  }
}

function isVerifiedCitation(citation: ResearchCitation): boolean {
  return citation.status === 'verified';
}

function citationBackedFindings(citations: ResearchCitation[]): string[] {
  return citations
    .filter((citation) => hasText(citation.title) || hasText(citation.excerpt))
    .map((citation) => {
      const title = citation.title.trim();
      const excerpt = citation.excerpt?.trim();
      if (excerpt) return `${title}: ${excerpt}`;
      return `Source identified for review: ${title}`;
    })
    .filter((finding) => !looksLikeGenericCompletion(finding));
}

function collectResearchCitations(run: AgentRun, results: AgentWorkerResult[]): ResearchCitation[] {
  return uniqueCitations([
    ...(run.plan?.researchEvidence?.citations ?? []),
    ...(run.plan?.citations ?? []),
    ...results.flatMap((result) => result.citations),
  ]);
}

function looksLikePlaceholderTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return normalized === 'worker summary' ||
    normalized === 'summary' ||
    normalized === 'draft' ||
    normalized.startsWith('worker ');
}

function looksLikeGenericCompletion(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (/^completed\s+[\w\s-]+\.?$/i.test(normalized)) return true;
  const lines = normalized.split(/(?:\n|;|\.)/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^-?\s*completed\s+/i.test(line));
}

function hasResearchTitle(title: string): boolean {
  return /\b(research|overview|brief|findings|analysis|source|sources)\b/i.test(title);
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function uniqueCitations(citations: AgentWorkerResult['citations']): AgentWorkerResult['citations'] {
  const seen = new Set<string>();
  const result: AgentWorkerResult['citations'] = [];
  for (const citation of citations) {
    const key = citation.url || citation.title;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(citation);
  }
  return result;
}

function uniqueMediaDrafts(drafts: AgentArtifactDraft[]): AgentArtifactDraft[] {
  const seen = new Set<string>();
  const result: AgentArtifactDraft[] = [];
  for (const draft of drafts) {
    if (draft.type !== 'media' || !hasText(draft.url)) continue;
    const key = draft.url;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(draft);
  }
  return result;
}

function mediaDraftLine(draft: AgentArtifactDraft): string {
  return [
    `- ${draft.title}`,
    draft.mediaKind ? `Kind: ${draft.mediaKind}` : '',
    draft.url ? `URL: ${draft.url}` : '',
    draft.summary ? `Note: ${draft.summary}` : '',
  ].filter(Boolean).join(' | ');
}
