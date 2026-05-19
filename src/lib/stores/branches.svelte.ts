/**
 * Branches store - reactive view over BranchService for the active note.
 *
 * Lists pending branches (alternative versions of note content). UI uses
 * this to render the branch picker modal. Refreshes on note path change.
 */

import type { BranchService } from '$lib/ports/inbound/BranchService';
import type { BranchComparison } from '$lib/ports/inbound/BranchService';
import type { Branch } from '$lib/domain/entities/Branch';

class BranchesStore {
  private service: BranchService | null = null;

  branches = $state<Branch[]>([]);
  comparisons = $state<Map<string, BranchComparison>>(new Map());
  loading = $state(false);
  error = $state<Error | null>(null);
  activePath = $state<string | null>(null);

  init(service: BranchService): void {
    this.service = service;
  }

  async fetchFor(notePath: string | null): Promise<void> {
    this.activePath = notePath;
    if (!this.service || !notePath) {
      this.branches = [];
      this.comparisons = new Map();
      this.error = null;
      return;
    }
    this.loading = true;
    this.error = null;
    const result = await this.service.getBranches(notePath);
    if (result.ok) {
      this.branches = result.value;
      await this.refreshComparisons();
    } else {
      this.branches = [];
      this.comparisons = new Map();
      this.error = result.error;
    }
    this.loading = false;
  }

  async accept(branchId: string): Promise<boolean> {
    if (!this.service || !this.activePath) return false;
    const result = await this.service.acceptBranch(this.activePath, branchId);
    if (result.ok) {
      // Refresh so accepted branches reflect new status
      await this.fetchFor(this.activePath);
      return true;
    }
    this.error = result.error;
    return false;
  }

  async reject(branchId: string): Promise<boolean> {
    if (!this.service || !this.activePath) return false;
    const result = await this.service.rejectBranch(this.activePath, branchId);
    if (result.ok) {
      this.branches = this.branches.filter((b) => b.id !== branchId);
      return true;
    }
    this.error = result.error;
    return false;
  }

  async restore(branchId: string): Promise<boolean> {
    if (!this.service || !this.activePath) return false;
    const result = await this.service.restoreBranch(this.activePath, branchId);
    if (result.ok) {
      await this.fetchFor(this.activePath);
      return true;
    }
    this.error = result.error;
    return false;
  }

  async compare(branchId: string): Promise<BranchComparison | null> {
    if (!this.service || !this.activePath) return null;
    const result = await this.service.compareBranch(this.activePath, branchId);
    if (!result.ok) {
      this.error = result.error;
      return null;
    }
    this.comparisons = new Map([...this.comparisons, [branchId, result.value]]);
    return result.value;
  }

  destroy(): void {
    this.service = null;
    this.branches = [];
    this.comparisons = new Map();
    this.activePath = null;
  }

  private async refreshComparisons(): Promise<void> {
    if (!this.service || !this.activePath) return;
    const next = new Map<string, BranchComparison>();
    for (const branch of this.branches) {
      const comparison = await this.service.compareBranch(this.activePath, branch.id);
      if (comparison.ok) next.set(branch.id, comparison.value);
    }
    this.comparisons = next;
  }
}

export const branchesStore = new BranchesStore();
