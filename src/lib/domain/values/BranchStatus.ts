/**
 * BranchStatus - Status of a draft branch
 *
 * Part of the Hexagonal Architecture domain layer.
 */

export const BRANCH_STATUSES = ['pending', 'accepted', 'rejected', 'expired'] as const;

export type BranchStatus = typeof BRANCH_STATUSES[number];

export function isValidBranchStatus(value: string): value is BranchStatus {
  return BRANCH_STATUSES.includes(value as BranchStatus);
}
