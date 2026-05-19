/**
 * Branch - Draft branch entity for alternative content versions
 *
 * A branch represents an alternative version of a section of content.
 * Users can create multiple branches to explore different takes on
 * the same section, then accept one.
 *
 * Part of the Hexagonal Architecture domain layer.
 */

import type { BranchStatus } from '../values/BranchStatus';

export interface Branch {
  /** Unique branch ID */
  id: string;

  /** When the branch was created */
  created: string;

  /** The prompt that generated this branch */
  prompt: string;

  /** Block range this branch applies to */
  blockRange: {
    from: string;
    to: string;
  } | null;

  /** The alternative content */
  content: string;

  /** Branch status */
  status: BranchStatus;

  /** Note path this branch can be applied to. Older branches may omit it. */
  notePath?: string;

  /** Markdown content at branch creation time, used for compare/restore. */
  baseContent?: string;

  /** Lineage metadata for branch-aware accepts. */
  lineage?: {
    baseSnapshotId?: string;
    branchIntentId?: string;
    sourceUnitIds?: string[];
  };

  /** Resolution timestamps. */
  acceptedAt?: string;
  rejectedAt?: string;
  restoredAt?: string;
}

/**
 * Create a new branch.
 */
export function createBranch(params: {
  prompt: string;
  content: string;
  blockRange?: { from: string; to: string } | null;
  notePath?: string;
  baseContent?: string;
  lineage?: Branch['lineage'];
}): Branch {
  const branch: Branch = {
    id: `branch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    created: new Date().toISOString(),
    prompt: params.prompt,
    blockRange: params.blockRange ?? null,
    content: params.content,
    status: 'pending',
  };
  if (params.notePath !== undefined) branch.notePath = params.notePath;
  if (params.baseContent !== undefined) branch.baseContent = params.baseContent;
  if (params.lineage !== undefined) branch.lineage = params.lineage;
  return branch;
}

/**
 * Accept a branch (mark as the chosen version).
 */
export function acceptBranch(branch: Branch): Branch {
  return { ...branch, status: 'accepted', acceptedAt: new Date().toISOString() };
}

/**
 * Reject a branch.
 */
export function rejectBranch(branch: Branch): Branch {
  return { ...branch, status: 'rejected', rejectedAt: new Date().toISOString() };
}

export function restoreBranch(branch: Branch): Branch {
  return { ...branch, status: 'pending', restoredAt: new Date().toISOString() };
}
