/**
 * BranchServiceImpl - Implementation of BranchService
 *
 * Manages draft branches using VoidStoragePort for persistence
 * and AIAssistantProviderPort for generating alternatives.
 *
 * Part of Hexagonal Architecture application layer.
 */

import { ok, err } from '$lib/core';
import type { Result } from '$lib/core/result';
import type { BranchService } from '$lib/ports/inbound/BranchService';
import type { VoidStoragePort } from '$lib/ports/outbound/VoidStoragePort';
import type { AIAssistantProviderPort } from '$lib/ports/outbound/AIAssistantProviderPort';
import type { Branch } from '$lib/domain/entities/Branch';
import { createBranch, acceptBranch, rejectBranch, restoreBranch } from '$lib/domain/entities/Branch';
import { branchDir, noteNameFromPath } from '$lib/domain/values/VoidPath';
import { createEmptyContext } from '$lib/domain/values/PromptContext';
import type { BranchComparison } from '$lib/ports/inbound/BranchService';
import type { DocumentService, NoteCollaborationService, LineageService } from '$lib/ports/inbound';

export class BranchServiceImpl implements BranchService {
  constructor(
    private readonly voidStorage: VoidStoragePort,
    private readonly aiProvider: AIAssistantProviderPort,
    private readonly notesPath: string,
    private readonly documents?: DocumentService,
    private readonly collaboration?: NoteCollaborationService,
    private readonly lineage?: LineageService,
  ) {}

  async createBranches(
    noteName: string,
    prompt: string,
    count = 3
  ): Promise<Result<Branch[], Error>> {
    try {
      const branches: Branch[] = [];
      const notePath = normalizeBranchNotePath(noteName);
      const baseContentResult = this.documents ? await this.documents.readContent(notePath) : null;
      const baseContent = baseContentResult?.ok ? baseContentResult.value : undefined;
      const snapshotResult = this.lineage ? await this.lineage.getSnapshot(notePath) : null;
      const baseSnapshot = snapshotResult?.ok ? snapshotResult.value : null;

      for (let i = 0; i < count; i++) {
        const result = await this.aiProvider.prompt({
          message: `${prompt}\n\nThis is version ${i + 1} of ${count}. Make each version distinct in approach, tone, or structure.`,
          context: createEmptyContext(),
          tools: [],
          conversationHistory: [],
        });

        if (!result.ok) continue;

        const branchParams: Parameters<typeof createBranch>[0] = {
          prompt,
          content: result.value.chat,
          notePath,
        };
        if (baseContent !== undefined) branchParams.baseContent = baseContent;
        if (baseSnapshot) {
          branchParams.lineage = {
            baseSnapshotId: baseSnapshot.id,
            sourceUnitIds: [...baseSnapshot.order],
          };
        }
        branches.push(createBranch(branchParams));
      }

      if (branches.length === 0) {
        return err(new Error('Failed to generate any branches'));
      }

      // Persist branches
      const dir = branchDir(noteNameFromPath(notePath));
      for (const branch of branches) {
        await this.voidStorage.writeJson(
          this.notesPath,
          `${dir}/${branch.id}.json`,
          branch
        );
      }

      return ok(branches);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async getBranches(noteName: string): Promise<Result<Branch[], Error>> {
    try {
      const dir = branchDir(noteNameFromPath(normalizeBranchNotePath(noteName)));
      const listResult = await this.voidStorage.listDir(this.notesPath, dir);

      if (!listResult.ok) return ok([]);

      const branches: Branch[] = [];
      for (const filename of listResult.value) {
        if (!filename.endsWith('.json')) continue;

        const readResult = await this.voidStorage.readJson<Branch>(
          this.notesPath,
          `${dir}/${filename}`
        );
        if (readResult.ok && readResult.value) {
          branches.push(readResult.value);
        }
      }

      // Sort by creation date
      branches.sort((a, b) => a.created.localeCompare(b.created));

      return ok(branches);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async getPendingBranches(noteName: string): Promise<Result<Branch[], Error>> {
    const result = await this.getBranches(noteName);
    if (!result.ok) return result;
    return ok(result.value.filter((b) => b.status === 'pending'));
  }

  async getBranch(noteName: string, branchId: string): Promise<Result<Branch | null, Error>> {
    try {
      const dir = branchDir(noteNameFromPath(normalizeBranchNotePath(noteName)));
      const readResult = await this.voidStorage.readJson<Branch>(
        this.notesPath,
        `${dir}/${branchId}.json`
      );
      if (!readResult.ok) return readResult;
      return ok(readResult.value);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async acceptBranch(noteName: string, branchId: string): Promise<Result<void, Error>> {
    try {
      const notePath = normalizeBranchNotePath(noteName);
      const dir = branchDir(noteNameFromPath(notePath));
      const path = `${dir}/${branchId}.json`;
      const readResult = await this.voidStorage.readJson<Branch>(this.notesPath, path);

      if (!readResult.ok || !readResult.value) {
        return err(new Error(`Branch ${branchId} not found`));
      }

      const targetPath = readResult.value.notePath ?? notePath;
      if (this.collaboration && targetPath.endsWith('.md')) {
        const write = await this.collaboration.applyNoteContent(
          targetPath,
          readResult.value.content,
          'Accept lineage branch',
          {
            actor: { kind: 'user' },
            intentKind: 'accept-branch',
            summary: `Accept branch ${branchId}`,
            commandId: 'lineage:branch.accept',
            branchId,
            source: { type: 'tool' },
          },
        );
        if (!write.ok) return err(write.error);
      }

      const updated = acceptBranch(readResult.value);
      await this.voidStorage.writeJson(this.notesPath, path, updated);

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async rejectBranch(noteName: string, branchId: string): Promise<Result<void, Error>> {
    try {
      const dir = branchDir(noteNameFromPath(normalizeBranchNotePath(noteName)));
      const path = `${dir}/${branchId}.json`;
      const readResult = await this.voidStorage.readJson<Branch>(this.notesPath, path);

      if (!readResult.ok || !readResult.value) {
        return err(new Error(`Branch ${branchId} not found`));
      }

      const updated = rejectBranch(readResult.value);
      await this.voidStorage.writeJson(this.notesPath, path, updated);

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async restoreBranch(noteName: string, branchId: string): Promise<Result<void, Error>> {
    try {
      const dir = branchDir(noteNameFromPath(normalizeBranchNotePath(noteName)));
      const path = `${dir}/${branchId}.json`;
      const readResult = await this.voidStorage.readJson<Branch>(this.notesPath, path);

      if (!readResult.ok || !readResult.value) {
        return err(new Error(`Branch ${branchId} not found`));
      }

      await this.voidStorage.writeJson(this.notesPath, path, restoreBranch(readResult.value));
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async compareBranch(
    noteName: string,
    branchId: string,
    currentMarkdown?: string
  ): Promise<Result<BranchComparison, Error>> {
    try {
      const branchResult = await this.getBranch(noteName, branchId);
      if (!branchResult.ok) return err(branchResult.error);
      const branch = branchResult.value;
      if (!branch) return err(new Error(`Branch ${branchId} not found`));

      const notePath = branch.notePath ?? normalizeBranchNotePath(noteName);
      let current = currentMarkdown ?? branch.baseContent ?? '';
      if (currentMarkdown === undefined && this.documents && notePath.endsWith('.md')) {
        const read = await this.documents.readContent(notePath);
        if (read.ok) current = read.value;
      }

      return ok(compareMarkdown(branchId, notePath, current, branch.content));
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function normalizeBranchNotePath(noteName: string): string {
  const normalized = noteName.replace(/\\/g, '/').replace(/^\/+/, '');
  return normalized.endsWith('.md') ? normalized : `${normalized}.md`;
}

function compareMarkdown(
  branchId: string,
  notePath: string,
  current: string,
  branch: string,
): BranchComparison {
  const currentLines = current.replace(/\r\n/g, '\n').split('\n');
  const branchLines = branch.replace(/\r\n/g, '\n').split('\n');
  const max = Math.max(currentLines.length, branchLines.length);
  const addedLines: string[] = [];
  const removedLines: string[] = [];
  let changedLineCount = 0;
  let unchangedLineCount = 0;

  for (let index = 0; index < max; index++) {
    const left = currentLines[index];
    const right = branchLines[index];
    if (left === right) {
      unchangedLineCount++;
      continue;
    }
    changedLineCount++;
    if (right !== undefined && right !== '') addedLines.push(right);
    if (left !== undefined && left !== '') removedLines.push(left);
  }

  const commitmentDelta = {
    added: branchLines.filter(isTodoLine).length - currentLines.filter(isTodoLine).length,
    removed: currentLines.filter(isTodoLine).length - branchLines.filter(isTodoLine).length,
  };

  return {
    branchId,
    notePath,
    addedLines,
    removedLines,
    changedLineCount,
    unchangedLineCount,
    commitmentDelta: {
      added: Math.max(0, commitmentDelta.added),
      removed: Math.max(0, commitmentDelta.removed),
    },
    summary: `${changedLineCount} changed line${changedLineCount === 1 ? '' : 's'}, ${Math.max(0, commitmentDelta.added)} commitment${commitmentDelta.added === 1 ? '' : 's'} added, ${Math.max(0, commitmentDelta.removed)} removed`,
  };
}

function isTodoLine(line: string): boolean {
  return /^\s*[-*+]\s+\[[ xX]\]\s+/.test(line);
}
