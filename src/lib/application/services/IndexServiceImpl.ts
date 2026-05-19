/**
 * IndexServiceImpl - Semantic note indexing implementation
 *
 * Extracts concepts from notes using lightweight keyword analysis
 * and builds a relationship graph. AI enrichment is optional.
 * Persists index data to .void/index/graph.json via VoidStoragePort.
 *
 * Part of the Hexagonal Architecture application layer.
 */

import { ok, err, type Result } from '$lib/core/result';
import { extractFrontmatterTags } from '$lib/core';
import type { IndexService, RelatedContext } from '$lib/ports/inbound/IndexService';
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';
import type { AIAssistantProviderPort } from '$lib/ports/outbound/AIAssistantProviderPort';
import type { NotesService } from '$lib/ports/inbound/NotesService';
import type { DocumentService } from '$lib/ports/inbound/DocumentService';
import type { IndexGraph, RelatedNote, NoteMatch, Relationship } from '$lib/domain/values/IndexGraph';
import { createEmptyGraph } from '$lib/domain/values/IndexGraph';
import { createEmptyContext } from '$lib/domain/values/PromptContext';
import type { NotesListItem } from '$lib/ports/inbound/NotesService';
import { getLogger } from '$lib/logging';

const log = getLogger('IndexService');
const GRAPH_PATH = 'index/graph.json';

/** Common stop words to filter out during concept extraction */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'shall', 'this', 'that',
  'these', 'those', 'it', 'its', 'i', 'you', 'he', 'she', 'we', 'they',
  'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'our', 'their',
  'not', 'no', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
  'other', 'some', 'such', 'than', 'too', 'very', 'just', 'also', 'about',
  'up', 'out', 'so', 'if', 'then', 'when', 'how', 'what', 'which', 'who',
  'where', 'why', 'as', 'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'between', 'under', 'over', 'again', 'once', 'here',
  'there', 'any', 'only', 'own', 'same', 'because', 'while', 'however',
  'new', 'like', 'get', 'make', 'well', 'back', 'even', 'still', 'way',
  'take', 'come', 'see', 'know', 'want', 'look', 'use', 'find', 'give',
  'tell', 'think', 'say', 'try', 'ask', 'work', 'seem', 'feel', 'need',
  'leave', 'call', 'keep', 'let', 'begin', 'show', 'hear', 'play', 'run',
  'move', 'live', 'believe', 'hold', 'bring', 'happen', 'write', 'provide',
  'sit', 'stand', 'lose', 'pay', 'meet', 'include', 'continue', 'set',
  'learn', 'change', 'lead', 'understand', 'watch', 'follow', 'stop',
  'create', 'speak', 'read', 'spend', 'grow', 'open', 'walk', 'win',
  'offer', 'remember', 'consider', 'appear', 'buy', 'wait', 'serve',
  'die', 'send', 'expect', 'build', 'stay', 'fall', 'cut', 'reach',
  'remain', 'suggest', 'raise', 'pass', 'sell', 'require', 'report',
  'decide', 'pull', 'todo', 'note', 'notes', 'untitled',
]);

export class IndexServiceImpl implements IndexService {
  constructor(
    private readonly storage: VoidStoragePort,
    private readonly ai: AIAssistantProviderPort,
    private readonly notes: NotesService,
    private readonly notesDir: string,
    private readonly documents: DocumentService
  ) {}

  async indexNote(noteName: string, content: string): Promise<Result<void, Error>> {
    const graphResult = await this.loadGraph();
    if (!graphResult.ok) return graphResult;

    const graph = graphResult.value;

    // Extract concepts using lightweight keyword analysis
    const concepts = this.extractConceptsLocal(noteName, content);
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

    // Update note index
    graph.notes[noteName] = {
      concepts,
      modified: new Date().toISOString(),
      wordCount,
    };

    // Rebuild relationships for this note
    this.rebuildRelationships(graph, noteName);

    // Persist
    return this.saveGraph(graph);
  }

  async indexAll(): Promise<Result<void, Error>> {
    const notesState = this.notes.getState();
    const allNotes = this.flattenNotes(notesState.items);

    const graphResult = await this.loadGraph();
    if (!graphResult.ok) return graphResult;

    const graph = graphResult.value;
    let indexed = 0;

    for (const note of allNotes) {
      // Skip if already indexed and not stale
      const existing = graph.notes[note.path];
      if (existing && existing.concepts.length > 0) continue;

      const contentResult = await this.documents.readContent(note.path);
      if (contentResult.ok) {
        const concepts = this.extractConceptsLocal(note.path, contentResult.value);
        const wordCount = contentResult.value.split(/\s+/).filter(w => w.length > 0).length;
        graph.notes[note.path] = {
          concepts,
          modified: new Date().toISOString(),
          wordCount,
        };
        indexed++;
      } else {
        // Title-only fallback when content cannot be read
        const concepts = this.extractConceptsLocal(note.path, '');
        graph.notes[note.path] = {
          concepts,
          modified: new Date().toISOString(),
          wordCount: 0,
        };
        indexed++;
      }
    }

    // Rebuild all relationships
    for (const noteName of Object.keys(graph.notes)) {
      this.rebuildRelationships(graph, noteName);
    }

    log.info('Index rebuilt', { total: allNotes.length, indexed });

    return this.saveGraph(graph);
  }

  async findRelated(noteName: string, limit = 5): Promise<Result<RelatedNote[], Error>> {
    const graphResult = await this.loadGraph();
    if (!graphResult.ok) return graphResult;

    const graph = graphResult.value;
    const noteIndex = graph.notes[noteName];
    if (!noteIndex) return ok([]);

    // Find notes with overlapping concepts
    const related = new Map<string, { concepts: string[]; strength: number }>();

    for (const concept of noteIndex.concepts) {
      for (const [otherName, otherIndex] of Object.entries(graph.notes)) {
        if (otherName === noteName) continue;

        if (otherIndex.concepts.includes(concept)) {
          const existing = related.get(otherName) ?? { concepts: [], strength: 0 };
          existing.concepts.push(concept);
          existing.strength = existing.concepts.length / Math.max(noteIndex.concepts.length, 1);
          related.set(otherName, existing);
        }
      }
    }

    // Sort by strength and limit
    const results: RelatedNote[] = Array.from(related.entries())
      .map(([path, data]) => ({
        path,
        title: path.replace(/\.md$/, ''),
        concepts: data.concepts,
        strength: data.strength,
      }))
      .sort((a, b) => b.strength - a.strength)
      .slice(0, limit);

    return ok(results);
  }

  async searchConcept(concept: string): Promise<Result<NoteMatch[], Error>> {
    const graphResult = await this.loadGraph();
    if (!graphResult.ok) return graphResult;

    const graph = graphResult.value;
    const lowerConcept = concept.toLowerCase();

    const matches: NoteMatch[] = [];
    for (const [noteName, noteIndex] of Object.entries(graph.notes)) {
      const matchedConcept = noteIndex.concepts.find(
        c => c.toLowerCase().includes(lowerConcept)
      );

      if (matchedConcept) {
        matches.push({
          path: noteName,
          title: noteName.replace(/\.md$/, ''),
          matchedConcept,
          relevance: matchedConcept.toLowerCase() === lowerConcept ? 1 : 0.5,
        });
      }
    }

    return ok(matches.sort((a, b) => b.relevance - a.relevance));
  }

  async getRelatedContext(noteName: string, limit = 5): Promise<Result<RelatedContext[], Error>> {
    const relatedResult = await this.findRelated(noteName, limit);
    if (!relatedResult.ok) return relatedResult;

    const contexts: RelatedContext[] = [];

    for (const related of relatedResult.value) {
      let excerpt = '';

      const contentResult = await this.documents.readContent(related.path);
      if (contentResult.ok) {
        // Take first ~400 chars, trimming at word boundary
        const raw = contentResult.value
          .replace(/^---\n[\s\S]*?\n---\n*/, '') // Strip frontmatter
          .trim();
        if (raw.length > 400) {
          const trimmed = raw.slice(0, 400);
          const lastSpace = trimmed.lastIndexOf(' ');
          excerpt = (lastSpace > 300 ? trimmed.slice(0, lastSpace) : trimmed) + '...';
        } else {
          excerpt = raw;
        }
      }

      contexts.push({
        path: related.path,
        title: related.title,
        concepts: related.concepts,
        excerpt,
        strength: related.strength,
      });
    }

    return ok(contexts);
  }

  async getGraph(): Promise<Result<IndexGraph, Error>> {
    return this.loadGraph();
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private async loadGraph(): Promise<Result<IndexGraph, Error>> {
    const result = await this.storage.readJson<IndexGraph>(this.notesDir, GRAPH_PATH);
    if (!result.ok) return result;
    return ok(result.value ?? createEmptyGraph());
  }

  private async saveGraph(graph: IndexGraph): Promise<Result<void, Error>> {
    return this.storage.writeJson(this.notesDir, GRAPH_PATH, graph);
  }

  /**
   * Extract concepts locally using keyword analysis.
   * No AI API call needed — fast and works offline.
   *
   * Sources: note title, markdown headings, tags (from frontmatter),
   * and high-frequency meaningful words from the content body.
   */
  private extractConceptsLocal(notePath: string, content: string): string[] {
    const concepts = new Set<string>();

    // 1. Extract from note title (filename without extension and path)
    const fileName = notePath.split('/').pop()?.replace(/\.md$/i, '') ?? '';
    const titleWords = fileName
      .replace(/[-_]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()));
    // Add the full title as a concept if it's meaningful
    if (fileName.length > 2 && !STOP_WORDS.has(fileName.toLowerCase())) {
      concepts.add(fileName.toLowerCase());
    }

    // 2. Extract from markdown headings
    const headingRegex = /^#{1,3}\s+(.+)$/gm;
    let match;
    while ((match = headingRegex.exec(content)) !== null) {
      const heading = match[1]!.trim().toLowerCase();
      if (heading.length > 2 && heading.length < 60) {
        concepts.add(heading);
      }
    }

    // 3. Extract tags from frontmatter
    const tags = extractFrontmatterTags(content);
    for (const tag of tags) {
      if (tag.length > 1) {
        concepts.add(tag);
      }
    }

    // 4. Extract high-frequency meaningful words from body
    const body = content
      .replace(/^---\n[\s\S]*?\n---/, '') // Remove frontmatter
      .replace(/```[\s\S]*?```/g, '')      // Remove code blocks
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // Extract link text
      .replace(/[#*_~`>|]/g, ' ')          // Remove markdown syntax
      .toLowerCase();

    const wordFreq = new Map<string, number>();
    const words = body.split(/\s+/).filter(w => {
      const cleaned = w.replace(/[^a-z0-9-]/g, '');
      return cleaned.length > 3 && !STOP_WORDS.has(cleaned);
    });

    for (const word of words) {
      const cleaned = word.replace(/[^a-z0-9-]/g, '');
      if (cleaned.length > 3) {
        wordFreq.set(cleaned, (wordFreq.get(cleaned) ?? 0) + 1);
      }
    }

    // Take top words by frequency (min 2 occurrences)
    const topWords = Array.from(wordFreq.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);

    for (const word of topWords) {
      concepts.add(word);
    }

    // Also add title words individually
    for (const word of titleWords) {
      concepts.add(word.toLowerCase());
    }

    // Return up to 8 concepts, prioritizing headings and tags
    return Array.from(concepts).slice(0, 8);
  }

  /**
   * Extract concepts using AI (optional enrichment).
   * Falls back to local extraction if AI is unavailable.
   */
  private async extractConceptsAI(content: string): Promise<Result<string[], Error>> {
    try {
      const result = await this.ai.prompt({
        message: `Extract 3-8 key concepts/topics from this text. Return ONLY a JSON array of strings, nothing else.\n\nText:\n${content.slice(0, 2000)}`,
        context: createEmptyContext(),
        tools: [],
        conversationHistory: [],
      });

      if (!result.ok) return err(result.error);

      try {
        const concepts = JSON.parse(result.value.chat) as string[];
        if (Array.isArray(concepts)) {
          return ok(concepts.filter(c => typeof c === 'string'));
        }
      } catch {
        const words = result.value.chat.split(',').map(s => s.trim().replace(/^["'\[\]]+|["'\[\]]+$/g, '')).filter(Boolean);
        return ok(words.slice(0, 8));
      }

      return ok([]);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private rebuildRelationships(graph: IndexGraph, noteName: string): void {
    // Remove old relationships involving this note
    graph.relationships = graph.relationships.filter(
      r => r.from !== noteName && r.to !== noteName
    );

    const noteIndex = graph.notes[noteName];
    if (!noteIndex) return;

    // Build new relationships
    for (const [otherName, otherIndex] of Object.entries(graph.notes)) {
      if (otherName === noteName) continue;

      for (const concept of noteIndex.concepts) {
        if (otherIndex.concepts.includes(concept)) {
          const overlap = noteIndex.concepts.filter(c => otherIndex.concepts.includes(c));
          const strength = overlap.length / Math.max(noteIndex.concepts.length, otherIndex.concepts.length);

          // Only add one relationship per pair per concept
          const existing = graph.relationships.find(
            r => r.from === noteName && r.to === otherName && r.concept === concept
          );

          if (!existing) {
            const rel: Relationship = {
              from: noteName,
              to: otherName,
              type: 'shared-concept',
              concept,
              strength,
            };
            graph.relationships.push(rel);
          }
        }
      }
    }
  }

  private flattenNotes(items: NotesListItem[]): Array<{ path: string; title: string }> {
    const result: Array<{ path: string; title: string }> = [];
    for (const item of items) {
      if (!item.isFolder) {
        result.push({ path: item.path, title: item.title });
      }
      if (item.children) {
        result.push(...this.flattenNotes(item.children));
      }
    }
    return result;
  }
}
