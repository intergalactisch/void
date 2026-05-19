/**
 * BranchService - Inbound port for draft branch management
 *
 * Manages alternative versions of note content (branches).
 * Users can explore different takes on a section without losing work.
 *
 * Part of the Hexagonal Architecture inbound ports layer.
 */

import type { Result } from '$lib/core/result';
import type { Branch } from '$lib/domain/entities/Branch';

export interface BranchComparison {
  branchId: string;
  notePath: string;
  addedLines: string[];
  removedLines: string[];
  changedLineCount: number;
  unchangedLineCount: number;
  commitmentDelta: {
    added: number;
    removed: number;
  };
  summary: string;
}

export interface BranchService {
  /**
   * Create branches for a note section.
   * @param noteName - The note to branch from
   * @param prompt - The generation prompt
   * @param count - Number of alternatives to generate (default 3)
   */
  createBranches(
    noteName: string,
    prompt: string,
    count?: number
  ): Promise<Result<Branch[], Error>>;

  /**
   * Get all branches for a note.
   */
  getBranches(noteName: string): Promise<Result<Branch[], Error>>;

  /**
   * Get a single branch for a note.
   */
  getBranch(noteName: string, branchId: string): Promise<Result<Branch | null, Error>>;

  /**
   * Get pending (unresolved) branches for a note.
   */
  getPendingBranches(noteName: string): Promise<Result<Branch[], Error>>;

  /**
   * Accept a branch (mark as chosen).
   */
  acceptBranch(noteName: string, branchId: string): Promise<Result<void, Error>>;

  /**
   * Reject a branch.
   */
  rejectBranch(noteName: string, branchId: string): Promise<Result<void, Error>>;

  /**
   * Restore a rejected/accepted branch back to pending.
   */
  restoreBranch(noteName: string, branchId: string): Promise<Result<void, Error>>;

  /**
   * Compare a branch against current note markdown or its stored base.
   */
  compareBranch(noteName: string, branchId: string, currentMarkdown?: string): Promise<Result<BranchComparison, Error>>;
}
